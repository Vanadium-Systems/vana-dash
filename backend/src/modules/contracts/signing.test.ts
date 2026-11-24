import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

// Without this the code and the links would go to Resend (test/setup.ts sets a key); the mails are read from here.
const sent = vi.hoisted(() => [] as { to: string; subject: string; text?: string; attachments?: unknown[] }[])
vi.mock('../../shared/lib/email.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/lib/email.js')>()),
  sendEmail: vi.fn(async (mail: (typeof sent)[number]) => {
    sent.push(mail)
  }),
}))

import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db, sql } from '../../shared/db/client.js'
import { auditLog, calendarEvents, contractDocuments, contracts, contractSignEvents, contractSignRequests, dashboardConfig, roles, users } from '../../shared/db/schema/index.js'
import { markSignatureRoles } from '../../shared/lib/pdf-signature-fields.js'
import { generateSigningCertificate, inspectPdf, isSigningAvailable } from '../../shared/lib/pdf-signing.js'
import { closeBrowser, htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { sessionToken } from '../../shared/testing/session-token.js'
import { readDocument } from '../../shared/lib/storage.js'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const execFileAsync = promisify(execFile)
const PYTHON = process.env.PDFSIGN_PYTHON ?? '/opt/pdfsign/bin/python'
const ready = isSigningAvailable() && isPdfAvailable() && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH ?? '')

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────

const OWNER_SIGN = `
import sys
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers
from pyhanko.sign.fields import SigFieldSpec
src, dst, cert, key = sys.argv[1:5]
signer = signers.SimpleSigner.load(key, cert)
writer = IncrementalPdfFileWriter(open(src, 'rb'))
fields.append_signature_field(writer, SigFieldSpec('Signature1', box=(40, 760, 200, 800)))
signers.PdfSigner(signers.PdfSignatureMetadata(field_name='Signature1', name='Owner'), signer=signer).sign_pdf(writer, output=open(dst, 'wb'))
`

async function ownerSign(pdf: Buffer): Promise<Buffer> {
  const cert = await generateSigningCertificate('QA Owner')
  const dir = await mkdtemp(join(tmpdir(), 'signing-test-'))
  try {
    const p = { src: join(dir, 'in.pdf'), dst: join(dir, 'out.pdf'), cert: join(dir, 'c.pem'), key: join(dir, 'k.pem') }
    await Promise.all([writeFile(p.src, pdf), writeFile(p.cert, cert.certPem), writeFile(p.key, cert.keyPem)])
    await execFileAsync(PYTHON, ['-c', OWNER_SIGN, p.src, p.dst, p.cert, p.key], { timeout: 60_000 })
    return await readFile(p.dst)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}
function tinyPng(): Buffer {
  const width = 16
  const height = 8
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x80)])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PNG_URL = `data:image/png;base64,${tinyPng().toString('base64')}`

const HTML = `<!doctype html><html><body><h1>Contract QA</h1>
<p data-sign-role="Colaborator">Semnătură colaborator</p><div style="height:300pt"></div>
<p data-sign-role="Colaborator">Semnătură colaborator, anexa</p></body></html>`

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

// ── setup ─────────────────────────────────────────────────────────────────────────────────────

const RUN = randomUUID().slice(0, 8)
const userIds: string[] = []
const roleIds: string[] = []
const contractIds: string[] = []
const SETTINGS_KEY = 'contract.signing'

describe.skipIf(!ready)('signing by link', async () => {
  const app = await buildServer()
  await app.ready()

  async function makeUser(label: string, features: string[], kind: 'custom' | 'admin' = 'custom') {
    const [role] = await db.insert(roles).values({ name: `QA signing ${label} ${RUN}`, kind, features }).returning()
    roleIds.push(role!.id)
    const [user] = await db
      .insert(users)
      .values({ email: `signing-${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: `QA ${label}`, roleId: role!.id })
      .returning()
    userIds.push(user!.id)
    return { id: user!.id, email: user!.email, cookie: `vana_session=${await sessionToken(app, user!.id)}` }
  }

  const SIGN_FEATURES = ['facturi.view', 'facturi.contracte', 'facturi.semnare-contracte']
  const owner = await makeUser('owner', SIGN_FEATURES)
  const other = await makeUser('other', SIGN_FEATURES)
  const noRight = await makeUser('noright', ['facturi.view', 'facturi.contracte'])
  const admin = await makeUser('admin', [], 'admin')

  const blank = await htmlToPdf(markSignatureRoles(HTML, []), { isolated: true, signatureFields: true })
  const ownerSigned = await ownerSign(blank)

  // The company's real certificate (if the dev database has one) is put back at the end.
  const [savedSettings] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, SETTINGS_KEY))
  if (savedSettings) await db.delete(dashboardConfig).where(eq(dashboardConfig.key, SETTINGS_KEY))

  afterAll(async () => {
    await db.delete(dashboardConfig).where(eq(dashboardConfig.key, SETTINGS_KEY))
    if (savedSettings) await db.insert(dashboardConfig).values({ key: SETTINGS_KEY, value: savedSettings.value })
    // The evidence table has no DELETE policy for the app role: with RLS on its rows (and the requests
    // that point at them) stay behind; the owner connection of a normal run removes them.
    if (!config.rlsEnabled && contractIds.length) {
      const requests = await db.select({ id: contractSignRequests.id }).from(contractSignRequests).where(inArray(contractSignRequests.contractId, contractIds))
      const requestIds = requests.map((r) => r.id)
      if (requestIds.length) await sql`delete from contract_sign_events where request_id = any(${requestIds})`
      await db.delete(contractSignRequests).where(inArray(contractSignRequests.contractId, contractIds))
      await db.delete(contractDocuments).where(inArray(contractDocuments.contractId, contractIds))
      await db.delete(auditLog).where(inArray(auditLog.entityId, contractIds))
    }
    if (!config.rlsEnabled) {
      await db.delete(calendarEvents).where(inArray(calendarEvents.ownerUserId, userIds))
      await db.delete(contracts).where(inArray(contracts.ownerUserId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
      await db.delete(roles).where(inArray(roles.id, roleIds))
    } else {
      // The users stay with their contracts; disabled, so the extra admin does not break "last active admin" in access tests.
      await db.update(users).set({ status: 'disabled' }).where(inArray(users.id, userIds))
    }
    await closeBrowser()
    await app.close()
  })

  function multipart(meta: object | undefined, file: Buffer) {
    const boundary = `----qa${RUN}`
    const chunks: Buffer[] = []
    if (meta) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`))
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`))
    return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
  }

  type Json = { data: Record<string, any>; error: { code: string; message: string } } // eslint-disable-line @typescript-eslint/no-explicit-any
  const json = (res: { json: () => unknown }) => res.json() as Json

  let counter = 0
  // A contract uploaded as signed takes no link: it goes up as "to sign", then our signed revision after it.
  async function newContract(pdf: Buffer, category = 'other') {
    const { payload, headers } = multipart({ title: `Sign QA ${RUN} ${++counter}`, category, status: 'to_sign', counterparty: { kind: 'other', name: 'Acme SRL' } }, blank)
    const res = await app.inject({ method: 'POST', url: '/api/contracts/registry/upload', headers: { cookie: owner.cookie, ...headers }, payload })
    if (res.statusCode !== 201) throw new Error(`upload failed: ${res.statusCode} ${res.body}`)
    const { id, documentId } = json(res).data as { id: string; documentId: string }
    contractIds.push(id)
    if (pdf === blank) return { contractId: id, documentId }
    const revision = await uploadRevision(documentId, pdf)
    return { contractId: id, documentId: revision }
  }

  async function uploadRevision(documentId: string, pdf: Buffer): Promise<string> {
    const { payload, headers } = multipart(undefined, pdf)
    const res = await app.inject({ method: 'POST', url: `/api/contracts/documents/${documentId}/signed`, headers: { cookie: owner.cookie, ...headers }, payload })
    if (res.statusCode !== 201) throw new Error(`revision failed: ${res.statusCode} ${res.body}`)
    return json(res).data.id as string
  }

  const sendRequest = (user: { cookie: string }, contractId: string, body: object = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/contracts/registry/${contractId}/sign-requests`,
      headers: { cookie: user.cookie },
      payload: { signerName: 'Ion Popescu', signerEmail: `signer-${RUN}-${counter}@example.com`, ...body },
    })

  // Each call comes from its own address: the routes are limited per IP and the file makes dozens of calls.
  let hop = 0
  const pub = (method: 'GET' | 'POST', token: string, tail: string, opts: { cookie?: string; body?: object } = {}) =>
    app.inject({
      method,
      url: `/api/public/sign/${token}${tail}`,
      headers: { 'x-forwarded-for': `10.${(++hop >> 8) & 255}.${hop & 255}.9`, 'user-agent': 'QA-browser', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
      payload: opts.body as object | undefined,
    })

  const tokenOf = (link: string) => link.split('/').pop()!
  const requestRow = async (token: string) => (await db.select().from(contractSignRequests).where(eq(contractSignRequests.tokenHash, sha256(token))))[0]!
  const requestRowById = async (id: string) => (await db.select().from(contractSignRequests).where(eq(contractSignRequests.id, id)))[0]!
  const eventKinds = async (requestId: string) => (await db.select().from(contractSignEvents).where(eq(contractSignEvents.requestId, requestId))).map((e) => e.kind)
  const codeSentTo = (email: string) => {
    const mail = [...sent].reverse().find((m) => m.to === email && /\b\d{6}\b/.test(m.subject))
    return /\b(\d{6})\b/.exec(mail?.subject ?? '')?.[1]
  }

  /** A contract signed by us, with a link sent: the state the signer starts from. */
  async function prepare(options: { pdf?: Buffer } = {}) {
    const { contractId, documentId } = await newContract(options.pdf ?? ownerSigned)
    const email = `signer-${RUN}-${counter}@example.com`
    const res = await sendRequest(owner, contractId, { signerEmail: email })
    expect(res.statusCode, res.body).toBe(201)
    const { id: requestId, link } = json(res).data as { id: string; link: string }
    return { contractId, documentId, requestId, email, token: tokenOf(link), link }
  }

  /** Asks for the code, reads it from the mail and verifies it: returns the session cookie. */
  async function logIn(token: string, email: string) {
    expect((await pub('POST', token, '/otp')).statusCode).toBe(200)
    const code = codeSentTo(email)
    expect(code).toMatch(/^\d{6}$/)
    const res = await pub('POST', token, '/verify', { body: { code } })
    expect(res.statusCode, res.body).toBe(200)
    return { cookie: `vd_sign=${res.cookies.find((c) => c.name === 'vd_sign')!.value}`, response: res, code: code! }
  }

  const sign = (token: string, cookie: string | undefined, signaturePng = PNG_URL) => pub('POST', token, '/sign', { cookie, body: { signaturePng, consent: true } })

  // ── from the contract page ──────────────────────────────────────────────────────────────────

  describe('internal routes', () => {
    it('refuses the request without facturi.semnare-contracte', async () => {
      const { contractId } = await newContract(ownerSigned)
      const res = await sendRequest(noRight, contractId)
      expect(res.statusCode).toBe(403)
    })

    it('says the certificate is missing before anything else is checked', async () => {
      const { contractId } = await newContract(ownerSigned)
      const res = await sendRequest(owner, contractId)
      expect(res.statusCode).toBe(400)
      expect(json(res).error.code).toBe('CONTRACT_SIGNING_CERT_MISSING')
    })

    it('generates the company certificate and never shows the key', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/contracts/signing/certificate', headers: { cookie: admin.cookie } })
      expect(res.statusCode, res.body).toBe(200)
      expect(json(res).data).toMatchObject({ hasCertificate: true })
      expect(res.body).not.toMatch(/PRIVATE KEY|keyEnc/)
      const settings = await app.inject({ method: 'GET', url: '/api/contracts/signing', headers: { cookie: owner.cookie } })
      expect(settings.body).not.toMatch(/PRIVATE KEY|keyEnc/)
      const [stored] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, SETTINGS_KEY))
      const value = stored!.value as { keyEnc: string }
      expect(value.keyEnc).toBeTruthy()
      expect(value.keyEnc).not.toContain('PRIVATE KEY')
    })

    it('wants our signature on the document first, unless it goes out unsigned on purpose', async () => {
      const { contractId } = await newContract(blank)
      const refused = await sendRequest(owner, contractId)
      expect(refused.statusCode).toBe(409)
      expect(json(refused).error.code).toBe('CONTRACT_SIGN_OWN_SIGNATURE_MISSING')

      const email = `signer-${RUN}-${counter}@example.com`
      const ok = await sendRequest(owner, contractId, { unsigned: true, signerEmail: email })
      expect(ok.statusCode, ok.body).toBe(201)
      expect(json(ok).data.link).toContain('/semnare/')
      expect(sent.some((m) => m.to === email && m.text?.includes(json(ok).data.link))).toBe(true)
    })

    it('sends a signed document with a link of its own', async () => {
      const { requestId, link, token } = await prepare()
      expect(link).toContain(`/semnare/${token}`)
      expect(await eventKinds(requestId)).toEqual(['sent'])
    })

    it('does not send employment contracts by link', async () => {
      const { contractId } = await newContract(ownerSigned, 'angajare')
      const res = await sendRequest(owner, contractId)
      expect(res.statusCode).toBe(400)
      expect(json(res).error.code).toBe('CONTRACT_SIGN_LINK_NOT_ALLOWED')
    })

    it('revokes the first link when a second one is sent for the same contract', async () => {
      const first = await prepare()
      const second = await sendRequest(owner, first.contractId, { signerEmail: `second-${RUN}@example.com` })
      expect(second.statusCode, second.body).toBe(201)
      expect((await requestRow(first.token)).status).toBe('revoked')
      const list = await app.inject({ method: 'GET', url: `/api/contracts/registry/${first.contractId}/sign-requests`, headers: { cookie: owner.cookie } })
      const statuses = (json(list).data as unknown as { id: string; status: string }[]).map((r) => r.status).sort()
      expect(statuses).toEqual(['revoked', 'sent'])
      expect(await eventKinds(first.requestId)).toContain('revoked')
    })

    it("answers 404 for someone else's contract", async () => {
      const { contractId, requestId } = await prepare()
      const res = await sendRequest(other, contractId)
      expect(res.statusCode).toBe(404)
      expect(json(res).error.code).toBe('CONTRACT_NOT_FOUND')
      const revoke = await app.inject({ method: 'DELETE', url: `/api/contracts/sign-requests/${requestId}`, headers: { cookie: other.cookie } })
      expect(revoke.statusCode).toBe(404)
      expect((await requestRowById(requestId)).status).toBe('sent')
    })

    it("does not list the signers of someone else's contract", async () => {
      const { contractId } = await prepare()
      const list = await app.inject({ method: 'GET', url: `/api/contracts/registry/${contractId}/sign-requests`, headers: { cookie: other.cookie } })
      expect(list.statusCode, list.body).toBe(404)
      expect(list.body).not.toContain('@example.com')
    })
  })

  // ── the public side ─────────────────────────────────────────────────────────────────────────

  describe('public link', () => {
    it('answers 404 for a token nobody has', async () => {
      const res = await pub('GET', randomBytes(32).toString('base64url'), '')
      expect(res.statusCode).toBe(404)
      expect(json(res).error.code).toBe('CONTRACT_SIGN_LINK_NOT_FOUND')
    })

    it('shows the page data without a code, but never the pages or the file', async () => {
      const { token, requestId } = await prepare()
      const page = await pub('GET', token, '')
      expect(page.statusCode).toBe(200)
      expect(json(page).data).toMatchObject({ status: 'opened', signerName: 'Ion Popescu', canDownload: false })
      expect(json(page).data.signerEmail).toMatch(/^si\*\*\*@/)
      expect(page.headers['cache-control']).toBe('no-store')
      expect(page.headers['x-robots-tag']).toContain('noindex')
      expect(await eventKinds(requestId)).toContain('opened')
      for (const tail of ['/pages/1', '/download']) {
        const res = await pub('GET', token, tail)
        expect(res.statusCode, tail).toBe(401)
        expect(json(res).error.code).toBe('CONTRACT_SIGN_SESSION_REQUIRED')
      }
      expect((await pub('POST', token, '/sign', { body: { signaturePng: PNG_URL, consent: true } })).statusCode).toBe(401)
    })

    it('counts down wrong codes and locks the link on the fifth', async () => {
      const { token, requestId, email } = await prepare()
      expect((await pub('POST', token, '/otp')).statusCode).toBe(200)
      const real = codeSentTo(email)!
      const wrong = String((Number(real) + 1) % 1_000_000).padStart(6, '0')

      const first = await pub('POST', token, '/verify', { body: { code: wrong } })
      expect(first.statusCode).toBe(400)
      expect(json(first).error.code).toBe('CONTRACT_SIGN_CODE_WRONG')
      // `left` goes into the message only, not as a field of the error
      expect(json(first).error.message).toMatch(/4/)
      for (let i = 0; i < 3; i++) expect((await pub('POST', token, '/verify', { body: { code: wrong } })).statusCode).toBe(400)
      const last = await pub('POST', token, '/verify', { body: { code: wrong } })
      expect(last.statusCode).toBe(423)
      expect(json(last).error.code).toBe('CONTRACT_SIGN_LINK_LOCKED')

      expect((await requestRow(token)).status).toBe('locked')
      expect(json(await pub('GET', token, '')).data.status).toBe('locked')
      // the right code no longer works
      expect((await pub('POST', token, '/verify', { body: { code: real } })).statusCode).toBe(423)
      expect(await eventKinds(requestId)).toContain('locked')
      expect(sent.some((m) => m.to === owner.email)).toBe(true)
    })

    it('refuses a code that has expired', async () => {
      const { token, email } = await prepare()
      expect((await pub('POST', token, '/otp')).statusCode).toBe(200)
      const code = codeSentTo(email)!
      await db.update(contractSignRequests).set({ otpExpiresAt: new Date(Date.now() - 60_000) }).where(eq(contractSignRequests.tokenHash, sha256(token)))
      const res = await pub('POST', token, '/verify', { body: { code } })
      expect(res.statusCode).toBe(400)
      expect(json(res).error.code).toBe('CONTRACT_SIGN_CODE_WRONG')
    })

    it('opens a session cookie tied to the link and shows the pages', async () => {
      const { token, email } = await prepare()
      const { response, cookie } = await logIn(token, email)
      const set = response.cookies.find((c) => c.name === 'vd_sign')!
      expect(set).toMatchObject({ path: `/api/public/sign/${token}`, httpOnly: true })
      expect(String(set.sameSite).toLowerCase()).toBe('strict')
      expect(json(response).data).toMatchObject({ pageCount: 1 })
      expect(json(response).data.documentSha256).toMatch(/^[0-9a-f]{64}$/)

      const page = await pub('GET', token, '/pages/1', { cookie })
      expect(page.statusCode).toBe(200)
      expect(page.headers['content-type']).toContain('image/png')
      expect(page.rawPayload.subarray(1, 4).toString('latin1')).toBe('PNG')
      expect((await pub('GET', token, '/pages/9', { cookie })).statusCode).toBe(404)

      const reading = await pub('GET', token, '/download', { cookie })
      expect(reading.statusCode).toBe(200)
      expect(reading.headers['content-type']).toContain('application/pdf')
      // the session of another link is worth nothing here
      const stranger = await prepare()
      expect((await pub('GET', stranger.token, '/pages/1', { cookie })).statusCode).toBe(401)
    })

    it('signs: new revision, certificate page, events, status, then a download', async () => {
      const { token, email, contractId, documentId, requestId } = await prepare()
      await pub('GET', token, '')
      const { cookie } = await logIn(token, email)

      const res = await sign(token, cookie)
      expect(res.statusCode, res.body).toBe(200)
      expect(json(res).data).toMatchObject({ signed: true })

      const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId))
      expect(contract!.status).toBe('signed')
      expect(contract!.signedOn).toBeTruthy()

      const docs = await db.select().from(contractDocuments).where(eq(contractDocuments.contractId, contractId))
      // our blank file, our signed revision, the signer's revision and the certificate page
      expect(docs).toHaveLength(4)
      expect(docs.filter((d) => d.docType === 'sign_certificate')).toHaveLength(1)
      const request = await requestRow(token)
      expect(request).toMatchObject({ status: 'signed', sessionHash: null })
      const signedDoc = docs.find((d) => d.id === request.signedDocumentId)!
      expect(signedDoc).toMatchObject({ isSigned: true, sourceDocumentId: documentId })
      expect(docs.find((d) => d.id === request.certificateDocumentId)?.docType).toBe('sign_certificate')
      expect(request.downloadUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)

      const final = await readDocument(signedDoc.pdfStoragePath)
      const original = await readDocument(docs.find((d) => d.id === documentId)!.pdfStoragePath)
      expect(final.subarray(0, original.length).equals(original)).toBe(true)
      const inspection = await inspectPdf(final)
      expect(inspection.emptyFields).toEqual([])
      expect(inspection.signatures.map((s) => s.field).sort()).toEqual(['Semnatura_Colaborator', 'Semnatura_Colaborator_2', 'Signature1'])
      expect(inspection.signatures.every((s) => s.intact && s.valid)).toBe(true)

      expect(await eventKinds(requestId)).toEqual(expect.arrayContaining(['sent', 'opened', 'otp_sent', 'otp_ok', 'signed']))
      expect(sent.filter((m) => m.to === email && m.attachments?.length === 2)).toHaveLength(1)

      // a second signature on the same link
      expect((await sign(token, cookie)).statusCode).toBe(409)
      expect(json(await pub('POST', token, '/otp')).error.code).toBe('CONTRACT_SIGN_ALREADY_SIGNED')

      // the signer downloads the final file, with no session (the link and the status are the proof)
      expect(json(await pub('GET', token, '')).data).toMatchObject({ status: 'signed', canDownload: true })
      const download = await pub('GET', token, '/download')
      expect(download.statusCode).toBe(200)
      expect(download.headers['content-type']).toContain('application/pdf')
      expect(download.rawPayload.equals(final)).toBe(true)
      expect(await eventKinds(requestId)).toContain('downloaded')

      await db.update(contractSignRequests).set({ downloadUntil: new Date(Date.now() - 1000) }).where(eq(contractSignRequests.id, requestId))
      const late = await pub('GET', token, '/download')
      expect(late.statusCode).toBe(410)
      expect(json(late).error.code).toBe('CONTRACT_SIGN_DOWNLOAD_EXPIRED')
      expect(json(await pub('GET', token, '')).data.canDownload).toBe(false)
    }, 120_000)

    it('refuses a drawn signature that is not a PNG', async () => {
      const { token, email, requestId } = await prepare()
      const { cookie } = await logIn(token, email)
      for (const bad of ['data:image/png;base64,AAAAAAAA', 'data:image/jpeg;base64,/9j/4AAQ', 'not a data url']) {
        const res = await sign(token, cookie, bad)
        expect(res.statusCode, bad).toBe(400)
        expect(json(res).error.code).toBe('CONTRACT_SIGN_IMAGE_INVALID')
      }
      expect((await requestRow(token)).status).not.toBe('signed')
      expect(await eventKinds(requestId)).not.toContain('signed')
    })

    it('answers 4xx, not 500, for a file that starts like a PNG but is not one', async () => {
      const { token, email } = await prepare()
      const { cookie } = await logIn(token, email)
      const fake = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]).toString('base64')}`
      const res = await sign(token, cookie, fake)
      expect(res.statusCode, res.body).toBeLessThan(500)
      expect((await requestRow(token)).status).not.toBe('signed')
    }, 60_000)

    it('answers 410 for a revoked link', async () => {
      const { token, requestId } = await prepare()
      const revoke = await app.inject({ method: 'DELETE', url: `/api/contracts/sign-requests/${requestId}`, headers: { cookie: owner.cookie } })
      expect(revoke.statusCode).toBe(200)
      const res = await pub('POST', token, '/otp')
      expect(res.statusCode).toBe(410)
      expect(json(res).error.code).toBe('CONTRACT_SIGN_LINK_REVOKED')
      expect((await pub('GET', token, '/pages/1')).statusCode).toBe(410)
    })

    it('answers 410 for an expired link', async () => {
      const { token } = await prepare()
      await db.update(contractSignRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(contractSignRequests.tokenHash, sha256(token)))
      const res = await pub('POST', token, '/otp')
      expect(res.statusCode).toBe(410)
      expect(json(res).error.code).toBe('CONTRACT_SIGN_LINK_EXPIRED')
      expect(json(await pub('GET', token, '')).data.status).toBe('expired')
    })

    it('revokes the link when the contract gets a new revision', async () => {
      const { token, email, documentId, requestId } = await prepare()
      const { cookie } = await logIn(token, email)
      await uploadRevision(documentId, ownerSigned)
      expect((await requestRow(token)).status).toBe('revoked')
      expect(await eventKinds(requestId)).toContain('revoked')
      const res = await sign(token, cookie)
      expect(res.statusCode).toBe(410)
      expect(json(res).error.code).toBe('CONTRACT_SIGN_LINK_REVOKED')
    })

    it('lets only one of two simultaneous signatures through, and signs the file once', async () => {
      const { token, email, contractId, requestId } = await prepare()
      const { cookie } = await logIn(token, email)
      const results = await Promise.all([sign(token, cookie), sign(token, cookie)])
      const codes = results.map((r) => r.statusCode).sort()
      expect(codes[0], results.map((r) => r.body).join(' | ')).toBe(200)
      expect([409, 410]).toContain(codes[1])

      const docs = await db.select().from(contractDocuments).where(eq(contractDocuments.contractId, contractId))
      expect(docs.filter((d) => d.docType === 'sign_certificate')).toHaveLength(1)
      expect(docs).toHaveLength(4)
      const request = await requestRow(token)
      const final = await readDocument(docs.find((d) => d.id === request.signedDocumentId)!.pdfStoragePath)
      const fieldNames = (await inspectPdf(final)).signatures.map((s) => s.field)
      expect(fieldNames.sort()).toEqual(['Semnatura_Colaborator', 'Semnatura_Colaborator_2', 'Signature1'])
      expect((await eventKinds(requestId)).filter((k) => k === 'signed')).toHaveLength(1)
    }, 120_000)
  })

  // ── the evidence table ──────────────────────────────────────────────────────────────────────

  describe('contract_sign_events', () => {
    it.skipIf(!config.rlsEnabled)('cannot be changed or deleted by the application role', async () => {
      const { requestId } = await prepare()
      const before = await db.select().from(contractSignEvents).where(eq(contractSignEvents.requestId, requestId))
      expect(before.length).toBeGreaterThan(0)
      const changed = await db.update(contractSignEvents).set({ kind: 'declined' }).where(eq(contractSignEvents.requestId, requestId)).returning()
      const removed = await db.delete(contractSignEvents).where(eq(contractSignEvents.requestId, requestId)).returning()
      expect(changed).toEqual([])
      expect(removed).toEqual([])
      const after = await db.select().from(contractSignEvents).where(eq(contractSignEvents.requestId, requestId))
      expect(after.map((e) => e.kind)).toEqual(before.map((e) => e.kind))
    })
  })
})
