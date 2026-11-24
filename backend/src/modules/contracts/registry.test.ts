import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { auditLog, calendarEvents, contractDocuments, contractNumbers, contracts, contractSeries, contractTemplates, roles, users } from '../../shared/db/schema/index.js'
import { closeBrowser, htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { sessionToken } from '../../shared/testing/session-token.js'
import { claimNumber } from './numbers.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const userIds: string[] = []
const roleIds: string[] = []
const templateNames = `QA registry ${RUN}`
// isPdfAvailable() only reads the env var; the binary has to exist too.
const pdfReady = isPdfAvailable() && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH ?? '')

async function makeUser(label: string, features: string[], kind: 'custom' | 'admin' = 'custom') {
  const [role] = await db.insert(roles).values({ name: `QA registry ${label} ${RUN}`, kind, features }).returning()
  roleIds.push(role!.id)
  const [user] = await db
    .insert(users)
    .values({ email: `registry-${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(user!.id)
  return { id: user!.id, cookie: `vana_session=${await sessionToken(app, user!.id)}` }
}

const userA = await makeUser('a', ['facturi.view', 'facturi.contracte'])
const userB = await makeUser('b', ['facturi.view', 'facturi.contracte'])
const manager = await makeUser('manager', ['facturi.view', 'facturi.contracte', 'facturi.sabloane-contracte'])
const admin = await makeUser('admin', [], 'admin')
const outsider = await makeUser('outsider', ['notite.view'])

async function minimalPdf() {
  const doc = await PDFDocument.create()
  doc.addPage()
  return Buffer.from(await doc.save())
}

function multipart(meta: object | undefined, file: { content: Buffer; type: string }) {
  const boundary = `----qa${RUN}`
  const chunks: Buffer[] = []
  if (meta) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`))
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.pdf"\r\nContent-Type: ${file.type}\r\n\r\n`), file.content, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

const baseMeta = (title: string, extra: object = {}) => ({ title, category: 'other', counterparty: { kind: 'other', name: 'Acme SRL' }, ...extra })

async function upload(user: { cookie: string }, meta: object | undefined, content?: Buffer, type = 'application/pdf') {
  const { payload, contentType } = multipart(meta, { content: content ?? (await minimalPdf()), type })
  return app.inject({ method: 'POST', url: '/api/contracts/registry/upload', headers: { cookie: user.cookie, 'content-type': contentType }, payload })
}

async function registryFiles(): Promise<string[]> {
  const root = path.resolve(config.storageDir, 'contracts/registry')
  return existsSync(root) ? readdir(root, { recursive: true }) : []
}

type Body = { data: { id: string; documentId: string; items: { id: string; number: number; kind: string }[]; [field: string]: unknown }; error: { code: string } }
const json = (res: { json: () => unknown }) => res.json() as Body

const seriesRes = await app.inject({
  method: 'POST',
  url: '/api/contracts/series',
  headers: { cookie: manager.cookie },
  payload: { code: `Q${RUN}`, name: 'QA', numberFormat: '{code}-{n:3}' },
})
if (seriesRes.statusCode !== 201) throw new Error(`series setup failed: ${seriesRes.statusCode} ${seriesRes.body}`)
const seriesId: string = json(seriesRes).data.id

afterAll(async () => {
  const owned = await db.select({ id: contracts.id }).from(contracts).where(inArray(contracts.ownerUserId, userIds))
  const contractIds = owned.map((c) => c.id)
  if (contractIds.length) {
    await db.delete(contractDocuments).where(inArray(contractDocuments.contractId, contractIds))
    await db.delete(auditLog).where(inArray(auditLog.entityId, contractIds))
  }
  await db.delete(calendarEvents).where(inArray(calendarEvents.ownerUserId, userIds))
  await db.delete(contracts).where(inArray(contracts.ownerUserId, userIds))
  await db.delete(contractNumbers).where(eq(contractNumbers.seriesId, seriesId))
  await db.delete(contractTemplates).where(eq(contractTemplates.seriesId, seriesId))
  await db.delete(contractTemplates).where(eq(contractTemplates.category, templateNames))
  await db.delete(contractSeries).where(eq(contractSeries.id, seriesId))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await closeBrowser()
  await app.close()
})

describe('access', () => {
  it('answers 401 without a session and 403 without the feature', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/contracts/registry' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/contracts/registry', headers: { cookie: outsider.cookie } })).statusCode).toBe(403)
  })

  it('keeps template writing for the role with its own feature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contracts/templates',
      headers: { cookie: userA.cookie },
      payload: { name: templateNames, category: templateNames, bodyHtml: '<p>x</p>' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('confidentiality', () => {
  it('shows a contract only to its owner and to the admin', async () => {
    const created = await upload(userA, baseMeta('Confidential QA'))
    expect(created.statusCode).toBe(201)
    const { id, documentId } = json(created).data

    expect((await app.inject({ method: 'GET', url: `/api/contracts/registry/${id}`, headers: { cookie: userA.cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/contracts/registry/${id}`, headers: { cookie: admin.cookie } })).statusCode).toBe(200)

    const foreign = await app.inject({ method: 'GET', url: `/api/contracts/registry/${id}`, headers: { cookie: userB.cookie } })
    expect(foreign.statusCode).toBe(404)
    expect(json(foreign).error.code).toBe('CONTRACT_NOT_FOUND')

    const listOf = async (user: { cookie: string }) =>
      json(await app.inject({ method: 'GET', url: '/api/contracts/registry?q=Confidential%20QA', headers: { cookie: user.cookie } })).data.items.map((i: { id: string }) => i.id)
    expect(await listOf(userB)).toEqual([])
    expect(await listOf(userA)).toEqual([id])
    expect(await listOf(admin)).toContain(id)

    const pdfUrl = `/api/contracts/documents/${documentId}/pdf`
    expect((await app.inject({ method: 'GET', url: pdfUrl, headers: { cookie: userB.cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: pdfUrl, headers: { cookie: userA.cookie } })).statusCode).toBe(200)
  })
})

describe('upload', () => {
  it('refuses without the feature and writes no file', async () => {
    const before = await registryFiles()
    const res = await upload(outsider, baseMeta('No right'))
    expect(res.statusCode).toBe(403)
    expect(await registryFiles()).toEqual(before)
  })

  it('stores a valid PDF as signed, with its number from the series', async () => {
    const res = await upload(userA, baseMeta('Signed upload', { seriesId, number: 3 }))
    expect(res.statusCode).toBe(201)
    const detail = json(await app.inject({ method: 'GET', url: `/api/contracts/registry/${json(res).data.id}`, headers: { cookie: userA.cookie } })).data
    expect(detail.status).toBe('signed')
    expect(detail.origin).toBe('uploaded')
    expect(detail.numberLabel).toBe(`Q${RUN}-003`)
  })

  it('answers 415 for a file that is not a PDF', async () => {
    const before = await registryFiles()
    const res = await upload(userA, baseMeta('Not a pdf'), Buffer.from('plain text, not a pdf'))
    expect(res.statusCode).toBe(415)
    const wrongType = await upload(userA, baseMeta('Wrong type'), await minimalPdf(), 'text/plain')
    expect(wrongType.statusCode).toBe(415)
    expect(await registryFiles()).toEqual(before)
  })

  it('answers 400 for a missing or invalid meta', async () => {
    expect((await upload(userA, undefined)).statusCode).toBe(400)
    expect((await upload(userA, { title: '' })).statusCode).toBe(400)
  })
})

describe('numbers', () => {
  const numbersOf = async (user = manager) =>
    json(await app.inject({ method: 'GET', url: `/api/contracts/numbers?seriesId=${seriesId}`, headers: { cookie: user.cookie } })).data.items as { number: number; kind: string }[]
  const reserve = (number: number) =>
    app.inject({ method: 'POST', url: '/api/contracts/numbers/reservations', headers: { cookie: manager.cookie }, payload: { seriesId, number, note: 'QA' } })

  it('refuses a number twice and gives a reserved one to the upload that names it', async () => {
    const first = await reserve(10)
    expect(first.statusCode).toBe(201)
    const again = await reserve(10)
    expect(again.statusCode).toBe(409)
    expect(json(again).error.code).toBe('CONTRACT_NUMBER_TAKEN')

    expect((await numbersOf()).find((n) => n.number === 10)?.kind).toBe('reserved')
    expect((await upload(userA, baseMeta('Takes the reservation', { seriesId, number: 10 }))).statusCode).toBe(201)
    expect((await numbersOf()).find((n) => n.number === 10)?.kind).toBe('used')
    expect((await upload(userA, baseMeta('Takes it again', { seriesId, number: 10 }))).statusCode).toBe(409)
  })

  it('answers 404 when deleting a reservation that does not exist', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/contracts/numbers/reservations/${randomUUID()}`, headers: { cookie: manager.cookie } })
    expect(res.statusCode).toBe(404)
    expect(json(res).error.code).toBe('CONTRACT_NUMBER_NOT_FOUND')
  })

  it('frees a reservation that is deleted', async () => {
    const created = await reserve(20)
    const del = await app.inject({ method: 'DELETE', url: `/api/contracts/numbers/reservations/${json(created).data.id}`, headers: { cookie: manager.cookie } })
    expect(del.statusCode).toBe(200)
    expect((await reserve(20)).statusCode).toBe(201)
  })

  it.skipIf(!pdfReady)('frees the number of a deleted draft', async () => {
    await upload(userA, baseMeta('Keeps the max up', { seriesId, number: 32 }))
    const template = await app.inject({
      method: 'POST',
      url: '/api/contracts/templates',
      headers: { cookie: manager.cookie },
      payload: { name: templateNames, category: templateNames, bodyHtml: '<p>{{contract.numar}} {{parte.nume}}</p>', seriesId },
    })
    expect(template.statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: '/api/contracts/numbers/reservations', headers: { cookie: manager.cookie }, payload: { seriesId, number: 30, note: 'QA' } })).statusCode).toBe(201)
    const draft = await app.inject({
      method: 'POST',
      url: '/api/contracts/registry',
      headers: { cookie: userA.cookie },
      payload: { templateId: json(template).data.id, counterparty: { kind: 'other', name: 'Acme SRL' }, seriesId, number: 30 },
    })
    expect(draft.statusCode).toBe(201)
    expect((await numbersOf()).find((n) => n.number === 30)?.kind).toBe('used')

    const del = await app.inject({ method: 'DELETE', url: `/api/contracts/registry/${json(draft).data.id}`, headers: { cookie: userA.cookie } })
    expect(del.statusCode).toBe(200)
    expect((await numbersOf()).find((n) => n.number === 30)?.kind).toBe('free')
  }, 60_000)

  it('lets exactly one of two simultaneous claims win', async () => {
    const claim = () =>
      db.transaction(async (tx) => {
        const [contract] = await tx
          .insert(contracts)
          .values({ title: 'Race QA', category: 'other', counterpartyKind: 'other', counterpartyName: 'Acme SRL', ownerUserId: userA.id, status: 'draft', origin: 'uploaded' })
          .returning({ id: contracts.id })
        await claimNumber(tx, seriesId, 50, contract!.id)
      })
    const results = await Promise.allSettled([claim(), claim()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(lost?.reason).toMatchObject({ statusCode: 409, code: 'CONTRACT_NUMBER_TAKEN' })
  })
})

describe('templates', () => {
  const create = (bodyHtml: string) =>
    app.inject({ method: 'POST', url: '/api/contracts/templates', headers: { cookie: manager.cookie }, payload: { name: templateNames, category: templateNames, bodyHtml } })

  it('refuses a token that is not a field', async () => {
    const res = await create('<p>{{xyz}}</p>')
    expect(res.statusCode).toBe(400)
    expect(json(res).error.code).toBe('CONTRACT_TEMPLATE_TOKENS_UNKNOWN')
  })

  it('saves a template with valid fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contracts/templates',
      headers: { cookie: manager.cookie },
      payload: {
        name: templateNames,
        category: templateNames,
        bodyHtml: '<p>{{scope}} {{contract.numar}}</p>',
        fields: [{ key: 'scope', label: { ro: 'Obiect', en: 'Scope' }, type: 'text', required: true }],
      },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('update', () => {
  it('follows the allowed status transitions', async () => {
    const { id } = json(await upload(userA, baseMeta('Transitions QA'))).data
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/contracts/registry/${id}`, headers: { cookie: userA.cookie }, payload })

    const back = await patch({ status: 'draft' })
    expect(back.statusCode).toBe(400)
    expect(json(back).error.code).toBe('CONTRACT_STATUS_TRANSITION')
    expect((await patch({ status: 'terminated' })).statusCode).toBe(200)
    expect((await patch({ status: 'signed' })).statusCode).toBe(400)
  })

  it('returns each edited field as it was sent', async () => {
    const { id } = json(await upload(userA, baseMeta('Round trip QA'))).data
    const edit = {
      title: 'Round trip edited',
      category: 'supplier',
      signedOn: '2030-01-10',
      startsOn: '2030-02-01',
      endsOn: '2031-01-31',
      autoRenew: true,
      renewalMonths: 12,
      noticeDays: 30,
      externalNumber: 'EXT-77',
    }
    const patched = await app.inject({ method: 'PATCH', url: `/api/contracts/registry/${id}`, headers: { cookie: userA.cookie }, payload: edit })
    expect(patched.statusCode).toBe(200)
    const detail = json(await app.inject({ method: 'GET', url: `/api/contracts/registry/${id}`, headers: { cookie: userA.cookie } })).data
    for (const [key, value] of Object.entries(edit)) expect(detail[key], key).toEqual(value)
  })
})

describe('isolated PDF', () => {
  it.skipIf(!pdfReady)('sends no request from the page when isolated', async () => {
    let hits = 0
    const server = http.createServer((_req, res) => {
      hits++
      res.writeHead(200, { 'content-type': 'image/png' }).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const html = `<img src="http://127.0.0.1:${(server.address() as AddressInfo).port}/x">`
    try {
      await htmlToPdf(html, { isolated: true, signatureFields: true })
      expect(hits).toBe(0)
      // Without isolation the same page does reach the server, so the zero above means something.
      await htmlToPdf(html)
      expect(hits).toBeGreaterThanOrEqual(1)
    } finally {
      server.close()
    }
  }, 60_000)
})
