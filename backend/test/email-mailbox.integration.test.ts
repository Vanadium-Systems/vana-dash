/**
 * Integration test — organizare mailbox (blocklist/reguli/spam la ingest, patch/bulk-update,
 * forward). PLAN.md Wave 1 — ordinea fixată: blocklist (cert) → reguli (control explicit) →
 * spam automat (doar dacă nicio regulă n-a decis deja un folder).
 *
 * Received messages are seeded through the Cloudflare Email Routing webhook
 * (`/api/webhooks/cloudflare-inbound`), the live ingest path. Unlike the old Resend fixture,
 * it needs no Svix signature and no mocked fetch to a second API: the payload already holds
 * the whole message.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { config } from '../src/shared/config.js'
import { db, sql } from '../src/shared/db/client.js'
import {
  emailBlocklist,
  emailLabels,
  emailMessages,
  emailRules,
  emailThreads,
  users,
  roles,
} from '../src/shared/db/schema/index.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const RUN_ID = Date.now()
const TEST_EMAIL = `test-mailbox-${RUN_ID}@test.local`
const TEST_PASSWORD = 'parola-de-test-123'
const CLOUDFLARE_TOKEN = config.cloudflareEmailIngestToken

let app: Awaited<ReturnType<typeof buildServer>>
let cookie = ''
const createdSubjects: string[] = []

function cloudflarePayload(messageId: string, from: string, subject: string, text = '') {
  return {
    from,
    to: 'stefan@vanadium.systems',
    subject,
    text,
    html: null,
    messageId: `<${messageId}@test.local>`,
    attachments: [],
  }
}

async function postCloudflareWebhook(payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/cloudflare-inbound',
    headers: { 'x-cloudflare-email-token': CLOUDFLARE_TOKEN },
    payload,
  })
}

async function findBySourceMessageId(messageId: string) {
  const [row] = await db.select().from(emailMessages).where(eq(emailMessages.sourceMessageId, `<${messageId}@test.local>`))
  return row
}

/** Forward-ul (spre deosebire de ingest) tot trimite prin Resend (regula #7 CLAUDE.md nu se
 *  aplică — SENDING rămâne pe Resend, doar RECEIVING s-a mutat) — necesită fetch mockuit. */
function mockOutboundSend() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.resend.com/emails') {
        return new Response(JSON.stringify({ id: `outbound-${Math.random()}` }), { status: 200 })
      }
      throw new Error(`fetch neașteptat: ${url}`)
    }),
  )
}

beforeAll(async () => {
  await db.insert(users).values({ email: TEST_EMAIL, passwordHash: await argon2.hash(TEST_PASSWORD), displayName: 'Test Mailbox', roleId: adminRoleId })
  app = await buildServer()
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: TEST_EMAIL, password: TEST_PASSWORD } })
  const setCookie = res.headers['set-cookie']
  cookie = (Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string)).split(';')[0]!
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL))
  if (createdSubjects.length) await db.delete(emailThreads).where(inArray(emailThreads.subject, createdSubjects))
  await sql`delete from email_rules where match_value like ${'%' + RUN_ID + '%'}`
  await sql`delete from email_blocklist where address like ${'%' + RUN_ID + '%'}`
  await sql`delete from email_labels where name like ${'%' + RUN_ID + '%'}`
  await app.close()
  await sql.end()
  await rm(path.resolve(config.storageDir), { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Ordinea la ingest: blocklist → reguli → spam automat', () => {
  it('blocklist match → trash direct, ignoră orice regulă', async () => {
    const blockedAddress = `blocked-${RUN_ID}@spam.example`
    await db.insert(emailBlocklist).values({ address: blockedAddress })

    const subject = `Blocklist test ${RUN_ID}`
    createdSubjects.push(subject)
    const messageId = `email-blocklist-${RUN_ID}`
    const res = await postCloudflareWebhook(cloudflarePayload(messageId, blockedAddress, subject))
    expect(res.statusCode).toBe(200)

    const message = await findBySourceMessageId(messageId)
    expect(message?.folder).toBe('trash')
  })

  it('o regulă (from_domain → label) are prioritate — nu e anulată de scorul de spam', async () => {
    const [label] = await db.insert(emailLabels).values({ name: `Contabilitate-${RUN_ID}` }).returning()
    await db.insert(emailRules).values({
      matchType: 'from_domain',
      matchValue: `trusted-${RUN_ID}.ro`,
      action: 'label',
      labelId: label!.id,
    })

    const from = `contabil@trusted-${RUN_ID}.ro`
    const subject = `URGENT CLICK HERE ${RUN_ID}` // ar declanșa spam dacă regula n-ar opri evaluarea
    createdSubjects.push(subject)
    const messageId = `email-rule-${RUN_ID}`
    const res = await postCloudflareWebhook(cloudflarePayload(messageId, from, subject))
    expect(res.statusCode).toBe(200)

    const message = await findBySourceMessageId(messageId)
    expect(message?.labelId).toBe(label!.id)
    expect(message?.folder).toBe('inbox') // regula a setat doar label, nu folder — rămâne inbox
  })

  it('fără nicio regulă + scor de spam peste prag → folder spam', async () => {
    const from = `unknown-sender-${RUN_ID}@nowhere.example`
    const subject = `YOU HAVE WON A PRIZE ${RUN_ID}`
    createdSubjects.push(subject)
    const messageId = `email-spam-${RUN_ID}`
    const res = await postCloudflareWebhook(
      cloudflarePayload(messageId, from, subject, 'Click here to claim now: http://prize.xyz/claim'),
    )
    expect(res.statusCode).toBe(200)

    const message = await findBySourceMessageId(messageId)
    expect(message?.folder).toBe('spam')
  })
})

describe('Filtru "Amânate" (snooze) — fără cron, doar la citire', () => {
  it('un mesaj amânat în viitor dispare din Inbox și apare la ?snoozed=true', async () => {
    const subject = `Snooze test ${RUN_ID}`
    createdSubjects.push(subject)
    const messageId = `email-snooze-${RUN_ID}`
    await postCloudflareWebhook(cloudflarePayload(messageId, `snooze-${RUN_ID}@example.com`, subject))
    const message = await findBySourceMessageId(messageId)

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/email/messages/${message!.id}`,
      headers: { cookie },
      payload: { snoozedUntil: future },
    })
    expect(patch.statusCode).toBe(200)

    const inbox = await app.inject({ method: 'GET', url: '/api/email/threads?folder=inbox', headers: { cookie } })
    expect(inbox.json().data.items.some((t: { id: string }) => t.id === message!.threadId)).toBe(false)

    const snoozed = await app.inject({ method: 'GET', url: '/api/email/threads?snoozed=true', headers: { cookie } })
    expect(snoozed.json().data.items.some((t: { id: string }) => t.id === message!.threadId)).toBe(true)
  })
})

describe('Acțiuni de mailbox', () => {
  it('PATCH /api/email/messages/:id actualizează isStarred/folder', async () => {
    const subject = `Patch test ${RUN_ID}`
    createdSubjects.push(subject)
    const messageId = `email-patch-${RUN_ID}`
    await postCloudflareWebhook(cloudflarePayload(messageId, `x-${RUN_ID}@example.com`, subject))
    const message = await findBySourceMessageId(messageId)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/email/messages/${message!.id}`,
      headers: { cookie },
      payload: { isStarred: true, folder: 'archive' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.isStarred).toBe(true)
    expect(res.json().data.folder).toBe('archive')
  })

  it('POST /api/email/messages/bulk-update — un singur update, afectează toate id-urile', async () => {
    const subjects = [`Bulk A ${RUN_ID}`, `Bulk B ${RUN_ID}`]
    createdSubjects.push(...subjects)
    const ids: string[] = []
    for (const [i, subject] of subjects.entries()) {
      const messageId = `email-bulk-${i}-${RUN_ID}`
      await postCloudflareWebhook(cloudflarePayload(messageId, `bulk-${i}-${RUN_ID}@example.com`, subject))
      const m = await findBySourceMessageId(messageId)
      ids.push(m!.id)
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/email/messages/bulk-update',
      headers: { cookie },
      payload: { ids, patch: { folder: 'trash', isRead: true } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.affected).toBe(2)

    const rows = await db.select().from(emailMessages).where(inArray(emailMessages.id, ids))
    expect(rows.every((r) => r.folder === 'trash' && r.isRead)).toBe(true)
  })

  it('forward pornește o conversație nouă, cu subiect Fwd: și re-atașează originalul', async () => {
    const subject = `Original pt forward ${RUN_ID}`
    createdSubjects.push(subject, `Fwd: ${subject}`)
    const messageId = `email-forward-src-${RUN_ID}`
    await postCloudflareWebhook(cloudflarePayload(messageId, `sender-${RUN_ID}@example.com`, subject, 'Corp original'))
    const original = await findBySourceMessageId(messageId)

    mockOutboundSend()
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/messages/${original!.id}/forward`,
      headers: { cookie },
      payload: { to: `forwarded-to-${RUN_ID}@example.com`, extraBody: 'Uite ce am primit' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.data.subject).toBe(`Fwd: ${subject}`)
    expect(body.data.forwardOfMessageId).toBe(original!.id)
    expect(body.data.bodyText).toContain('Corp original')
  })
})
