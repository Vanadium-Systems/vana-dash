/**
 * Integration test — CRUD etichete/reguli/blocklist + "apply-existing" (UPDATE retroactiv,
 * SQL direct — regula #9 CLAUDE.md) + flux complet draft: create → update → send → dispare.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { config } from '../src/shared/config.js'
import { db, sql } from '../src/shared/db/client.js'
import { emailDrafts, emailMessages, emailThreads, users, roles } from '../src/shared/db/schema/index.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const RUN_ID = Date.now()
const TEST_EMAIL = `test-organize-${RUN_ID}@test.local`
const TEST_PASSWORD = 'parola-de-test-123'

let app: Awaited<ReturnType<typeof buildServer>>
let cookie = ''
const createdSubjects: string[] = []

beforeAll(async () => {
  await db.insert(users).values({ email: TEST_EMAIL, passwordHash: await argon2.hash(TEST_PASSWORD), displayName: 'Test Organize', roleId: adminRoleId })
  app = await buildServer()
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: TEST_EMAIL, password: TEST_PASSWORD } })
  const setCookie = res.headers['set-cookie']
  cookie = (Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string)).split(';')[0]!
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL))
  if (createdSubjects.length) await db.delete(emailThreads).where(inArray(emailThreads.subject, createdSubjects))
  await sql`delete from email_labels where name like ${'%' + RUN_ID + '%'}`
  await sql`delete from email_rules where match_value like ${'%' + RUN_ID + '%'}`
  await sql`delete from email_blocklist where address like ${'%' + RUN_ID + '%'}`
  await app.close()
  await sql.end()
  await rm(path.resolve(config.storageDir), { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Labels CRUD', () => {
  it('create → list → update → delete', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/email/labels',
      headers: { cookie },
      payload: { name: `Contabilitate-${RUN_ID}` },
    })
    expect(create.statusCode).toBe(201)
    const label = create.json().data

    const list = await app.inject({ method: 'GET', url: '/api/email/labels', headers: { cookie } })
    expect(list.json().data.some((l: { id: string }) => l.id === label.id)).toBe(true)

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/email/labels/${label.id}`,
      headers: { cookie },
      payload: { color: '#ff0000' },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().data.color).toBe('#ff0000')

    const del = await app.inject({ method: 'DELETE', url: `/api/email/labels/${label.id}`, headers: { cookie } })
    expect(del.statusCode).toBe(200)
  })
})

describe('Rules — apply-existing (UPDATE retroactiv)', () => {
  it('aplică o regulă pe mesaje deja existente, un singur update afectează toate potrivirile', async () => {
    const labelRes = await app.inject({
      method: 'POST',
      url: '/api/email/labels',
      headers: { cookie },
      payload: { name: `Retroactiv-${RUN_ID}` },
    })
    const labelId = labelRes.json().data.id

    // Două thread-uri/mesaje deja existente de la același domeniu, ÎNAINTE de regulă.
    const domain = `retro-${RUN_ID}.ro`
    const subjects = [`Retro A ${RUN_ID}`, `Retro B ${RUN_ID}`]
    createdSubjects.push(...subjects)
    for (const subject of subjects) {
      const [thread] = await db
        .insert(emailThreads)
        .values({ subject, participants: [`x@${domain}`], lastMessageAt: new Date() })
        .returning()
      await db.insert(emailMessages).values({
        threadId: thread!.id,
        direction: 'in',
        fromAddress: `x@${domain}`,
        toAddress: 'inbox@mail.vanadium.systems',
        subject,
        bodyText: 'test',
        receivedAt: new Date(),
      })
    }

    const ruleRes = await app.inject({
      method: 'POST',
      url: '/api/email/rules',
      headers: { cookie },
      payload: { matchType: 'from_domain', matchValue: domain, action: 'label', labelId },
    })
    expect(ruleRes.statusCode).toBe(201)
    const ruleId = ruleRes.json().data.id

    const applyRes = await app.inject({ method: 'POST', url: `/api/email/rules/${ruleId}/apply-existing`, headers: { cookie } })
    expect(applyRes.statusCode).toBe(200)
    expect(applyRes.json().data.affected).toBe(2)

    const messages = await db.select().from(emailMessages).where(inArray(emailMessages.subject, subjects))
    expect(messages.every((m) => m.labelId === labelId)).toBe(true)
  })

  it('respinge create fără labelId când action=label', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/email/rules',
      headers: { cookie },
      payload: { matchType: 'subject_contains', matchValue: `nolabel-${RUN_ID}`, action: 'label' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('Blocklist — apply-existing', () => {
  it('trece retroactiv mesajele existente în trash', async () => {
    const address = `blocked-retro-${RUN_ID}@spam.example`
    const subject = `Blocklist retro ${RUN_ID}`
    createdSubjects.push(subject)
    const [thread] = await db.insert(emailThreads).values({ subject, participants: [address], lastMessageAt: new Date() }).returning()
    await db.insert(emailMessages).values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: address,
      toAddress: 'inbox@mail.vanadium.systems',
      subject,
      bodyText: 'test',
      receivedAt: new Date(),
      folder: 'inbox',
    })

    const addRes = await app.inject({ method: 'POST', url: '/api/email/blocklist', headers: { cookie }, payload: { address } })
    expect(addRes.statusCode).toBe(201)
    const entryId = addRes.json().data.id

    const applyRes = await app.inject({ method: 'POST', url: `/api/email/blocklist/${entryId}/apply-existing`, headers: { cookie } })
    expect(applyRes.statusCode).toBe(200)
    expect(applyRes.json().data.affected).toBe(1)

    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.subject, subject))
    expect(message?.folder).toBe('trash')
  })
})

describe('Drafts — create → update → send → dispare', () => {
  it('flux complet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: `draft-send-${RUN_ID}` }), { status: 200 })),
    )

    const create = await app.inject({
      method: 'POST',
      url: '/api/email/drafts',
      headers: { cookie },
      payload: { fromKey: 'stefan', to: '', subject: `Draft ${RUN_ID}`, body: 'schiță' },
    })
    expect(create.statusCode).toBe(201)
    const draftId = create.json().data.id

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/email/drafts/${draftId}`,
      headers: { cookie },
      payload: { to: `destinatar-${RUN_ID}@example.com` },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().data.to).toBe(`destinatar-${RUN_ID}@example.com`)

    const send = await app.inject({ method: 'POST', url: `/api/email/drafts/${draftId}/send`, headers: { cookie } })
    expect(send.statusCode).toBe(200)

    const [remaining] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId))
    expect(remaining).toBeUndefined() // draftul a dispărut după trimitere
  })

  it('refuză trimiterea unui draft fără destinatar', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/email/drafts',
      headers: { cookie },
      payload: { fromKey: 'stefan', subject: `Fara destinatar ${RUN_ID}`, body: 'x' },
    })
    const draftId = create.json().data.id

    const send = await app.inject({ method: 'POST', url: `/api/email/drafts/${draftId}/send`, headers: { cookie } })
    expect(send.statusCode).toBe(400)
  })
})
