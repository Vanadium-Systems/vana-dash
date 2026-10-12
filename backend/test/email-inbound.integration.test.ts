/**
 * Integration tests for the Email module: threads and replies. They run on the dev Postgres
 * (infra/docker-compose.yml), like test/integration.test.ts.
 *
 * Received messages are seeded through the Cloudflare Email Routing webhook, which is the
 * live ingest path. Receiving through Resend was dropped, and its ingest, idempotency and
 * attachment tests went with the code.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { config } from '../src/shared/config.js'
import { db, sql } from '../src/shared/db/client.js'
import { emailMessages, emailThreads, users, roles } from '../src/shared/db/schema/index.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const RUN_ID = Date.now()
const TEST_EMAIL = `test-inbound-${RUN_ID}@test.local`
const TEST_PASSWORD = 'parola-de-test-123'
const CLOUDFLARE_TOKEN = config.cloudflareEmailIngestToken
const SUBJECT_1 = `Salut de la client ${RUN_ID}`
const MESSAGE_ID_1 = `<msg-1-${RUN_ID}@extern.ro>`

let app: Awaited<ReturnType<typeof buildServer>>
let cookie = ''

async function postCloudflareWebhook(payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/cloudflare-inbound',
    headers: { 'x-cloudflare-email-token': CLOUDFLARE_TOKEN },
    payload,
  })
}

function mockResendSendFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === 'https://api.resend.com/emails') {
      return new Response(JSON.stringify({ id: 'outbound-1' }), { status: 200 })
    }
    throw new Error(`fetch neașteptat în test: ${url}`)
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

beforeAll(async () => {
  await db.insert(users).values({
    email: TEST_EMAIL,
    passwordHash: await argon2.hash(TEST_PASSWORD),
    displayName: 'Test Inbound',
    roleId: adminRoleId,
  })
  app = await buildServer()

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
  })
  const setCookie = res.headers['set-cookie']
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string)
  cookie = cookieStr.split(';')[0]!

  // Fixture — un mesaj primit prin calea Cloudflare, folosit de toate testele de mai jos.
  const seedRes = await postCloudflareWebhook({
    from: 'client@example.com',
    to: 'inbox@mail.vanadium.systems',
    subject: SUBJECT_1,
    text: 'Continut de test',
    html: null,
    messageId: MESSAGE_ID_1,
    attachments: [],
  })
  if (seedRes.statusCode !== 200) throw new Error(`fixture Cloudflare inbound a eșuat: ${seedRes.statusCode} ${seedRes.body}`)
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL))
  // Cascade pe emailThreads → emailMessages → emailAttachments (onDelete: 'cascade',
  // vezi schema) — un singur delete curăță tot ce a creat testul ăsta.
  await db.delete(emailThreads).where(inArray(emailThreads.subject, [SUBJECT_1]))
  await sql`delete from sync_log where job_key = 'email:cloudflare-inbound' and started_at > now() - interval '5 minutes'`
  await app.close()
  await sql.end()
  // config.storageDir e `./storage-test` în teste (vezi test/setup.ts) — dedicat,
  // curățat integral, nu doar subfolderul atins de testul ăsta.
  await rm(path.resolve(config.storageDir), { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/email/threads + reply', () => {
  it('cere autentificare', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/email/threads' })
    expect(res.statusCode).toBe(401)
  })

  it('listează thread-urile create din webhook, sortate lastMessageAt desc', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/email/threads', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.items)).toBe(true)
    expect(body.data.items.length).toBeGreaterThan(0)
    expect(body.data.total).toBeGreaterThan(0)
  })

  it('GET /:id întoarce thread + mesaje; reply setează In-Reply-To/References din sourceMessageId', async () => {
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.sourceMessageId, MESSAGE_ID_1))
    const threadId = message!.threadId

    const getRes = await app.inject({ method: 'GET', url: `/api/email/threads/${threadId}`, headers: { cookie } })
    expect(getRes.statusCode).toBe(200)
    const getBody = getRes.json()
    expect(getBody.data.thread.id).toBe(threadId)
    expect(getBody.data.messages.length).toBeGreaterThan(0)

    const calls = mockResendSendFetch()
    const replyRes = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${threadId}/reply`,
      headers: { cookie },
      payload: { body: 'Răspuns de test' },
    })
    expect(replyRes.statusCode).toBe(201)
    const replyBody = replyRes.json()
    expect(replyBody.data.direction).toBe('out')
    expect(replyBody.data.toAddress).toBe('client@example.com')
    expect(replyBody.data.subject).toMatch(/^Re: /)

    const sendCall = calls.find((c) => c.url === 'https://api.resend.com/emails')
    expect(sendCall).toBeDefined()
    const sentBody = JSON.parse(sendCall!.init!.body as string)
    expect(sentBody.headers['In-Reply-To']).toBe(MESSAGE_ID_1)
    expect(sentBody.headers.References).toBe(MESSAGE_ID_1)
    expect(sentBody.from).toBe('inbox@mail.vanadium.systems')
    // Bug găsit de Stefan (2026-07-17): reply-urile nu adăugau NICIODATĂ semnătura — sentBody
    // (ce ajunge efectiv la Resend) trebuie s-o conțină, dar rândul stocat (bodyText, ce se
    // vede în UI) rămâne curat, ca la Compose.
    expect(sentBody.text).toContain('\n\n--\n')
    expect(sentBody.text.startsWith('Răspuns de test')).toBe(true)
    expect(replyBody.data.bodyText).toBe('Răspuns de test')
  })

  it('404 pentru un thread inexistent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/email/threads/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
  })
})
