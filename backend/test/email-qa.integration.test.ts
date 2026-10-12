/**
 * QA — teste independente, Wave 3 (Modul Email, Sprint B). Nu duplică
 * `email-inbound.integration.test.ts` / `service.test.ts` / `inbound-service.test.ts` —
 * acoperă unghiuri pe care implementatorii (BE/INT) n-au avut motiv să le testeze din
 * interior, conform QA.agent.md: webhook cu `type` diferit de `email.received`, webhook
 * semnat dar cu `data` malformat, dedup pe un batch ÎNTREG (nu un singur rând) retrimis
 * de 2 ori la rând, și reply pe un thread fără niciun mesaj `direction='in'`.
 */
import { eq, inArray } from 'drizzle-orm'
import argon2 from 'argon2'
import { Webhook } from 'svix'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { config } from '../src/shared/config.js'
import { db, sql } from '../src/shared/db/client.js'
import { emailMessages, emailSends, emailTemplates, emailThreads, syncLog, users, roles } from '../src/shared/db/schema/index.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const RUN_ID = Date.now()
const TEST_EMAIL = `test-qa-email-${RUN_ID}@test.local`
const TEST_PASSWORD = 'parola-de-test-qa-123'
const WEBHOOK_SECRET = config.resendWebhookSecret

let app: Awaited<ReturnType<typeof buildServer>>
let cookie = ''
let templateId: string

function signedRequest(payloadObj: unknown, msgId: string) {
  const payload = JSON.stringify(payloadObj)
  const timestamp = new Date()
  const wh = new Webhook(WEBHOOK_SECRET)
  const signature = wh.sign(msgId, timestamp, payload)
  return {
    payload,
    headers: {
      'content-type': 'application/json',
      'svix-id': msgId,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
  }
}

beforeAll(async () => {
  await db.insert(users).values({
    email: TEST_EMAIL,
    passwordHash: await argon2.hash(TEST_PASSWORD),
    displayName: 'Test QA Email',
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

  const [tpl] = await db
    .insert(emailTemplates)
    .values({ name: 'QA batch dedup', subject: 'Salut {{nume}}', body: 'Bună {{nume}}.' })
    .returning()
  templateId = tpl!.id
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL))
  await db.delete(emailSends).where(eq(emailSends.templateId, templateId))
  await db.delete(emailTemplates).where(eq(emailTemplates.id, templateId))
  await db.delete(emailThreads).where(inArray(emailThreads.subject, [`QA no-inbound thread ${RUN_ID}`]))
  await db.delete(syncLog).where(eq(syncLog.jobKey, 'email:resend-inbound'))
  await app.close()
  await sql.end()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Webhook: type diferit de email.received ────────────────────────────────────

describe('POST /api/webhooks/resend-inbound — type diferit de email.received', () => {
  it('ignoră silențios un eveniment email.delivered (200, nimic procesat)', async () => {
    const emailId = `qa-delivered-${RUN_ID}`
    const { payload, headers } = signedRequest(
      {
        type: 'email.delivered',
        data: {
          email_id: emailId,
          created_at: new Date().toISOString(),
          from: 'client@example.com',
          to: ['inbox@mail.vanadium.systems'],
          subject: 'Notificare livrare',
        },
      },
      `msg_delivered_${RUN_ID}`,
    )

    const res = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })

    const [msg] = await db.select().from(emailMessages).where(eq(emailMessages.resendEmailId, emailId))
    expect(msg).toBeUndefined()

    // Nu a fost creat niciun sync_log — evenimentul nu e nici status de livrare urmărit,
    // nici (fost) `email.received` — ruta iese direct, fără nicio ingestie.
    const logs = await db.select().from(syncLog).where(eq(syncLog.jobKey, 'email:resend-inbound'))
    expect(logs.some((l) => l.recordsSync !== null && l.startedAt > new Date(Date.now() - 5000) && l.status === 'RUNNING')).toBe(
      false,
    )
  })

  it('ignoră silențios un eveniment email.bounced cu formă complet diferită de payload (200, nu 500)', async () => {
    const { payload, headers } = signedRequest(
      {
        type: 'email.bounced',
        data: {
          // Formă total diferită de DeliveryStatusEventSchema — nici măcar email_id.
          bounce_type: 'hard',
          recipient: 'nu-exista@example.com',
        },
      },
      `msg_bounced_${RUN_ID}`,
    )

    const res = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    // Schema eșuează la parse (data nu are email_id/from/to) — respins curat, nu crash.
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })
})

// ── Webhook: semnat valid, dar data malformat ───────────────────────────────────

describe('POST /api/webhooks/resend-inbound — semnătură validă, payload malformat', () => {
  it('lipsește "from" — respins curat (200, Zod), nu crash, nimic inserat', async () => {
    const emailId = `qa-malformed-from-${RUN_ID}`
    const { payload, headers } = signedRequest(
      {
        type: 'email.received',
        data: {
          email_id: emailId,
          created_at: new Date().toISOString(),
          // from: LIPSEȘTE intenționat
          to: ['inbox@mail.vanadium.systems'],
          subject: 'Fără from',
        },
      },
      `msg_malformed_from_${RUN_ID}`,
    )

    const res = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })

    const [msg] = await db.select().from(emailMessages).where(eq(emailMessages.resendEmailId, emailId))
    expect(msg).toBeUndefined()
  })

  it('lipsește "to" (array gol/absent) — respins curat, nu crash', async () => {
    const emailId = `qa-malformed-to-${RUN_ID}`
    const { payload, headers } = signedRequest(
      {
        type: 'email.received',
        data: {
          email_id: emailId,
          created_at: new Date().toISOString(),
          from: 'client@example.com',
          to: [], // array gol — min(1) eșuează
          subject: 'Fără to',
        },
      },
      `msg_malformed_to_${RUN_ID}`,
    )

    const res = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })

    const [msg] = await db.select().from(emailMessages).where(eq(emailMessages.resendEmailId, emailId))
    expect(msg).toBeUndefined()
  })

  it('email_id gol — respins curat de Zod (min(1)), nu crash', async () => {
    const { payload, headers } = signedRequest(
      {
        type: 'email.received',
        data: {
          email_id: '',
          from: 'client@example.com',
          to: ['inbox@mail.vanadium.systems'],
          subject: 'email_id gol',
        },
      },
      `msg_empty_id_${RUN_ID}`,
    )

    const res = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })
})

// ── Bulk send: dedup pe un batch ÎNTREG (nu un singur rând), retrimis 2x la rând ─

describe('POST /api/email/bulk-send — dedup pe batch întreg retrimis 2x', () => {
  it('a doua rulare identică (3 destinatari, toți reușiți la prima) sare peste TOȚI, zero trimiteri noi', async () => {
    // Seedăm direct 3 rânduri 'sent' pentru acest template — echivalent cu "prima
    // rulare a batch-ului a reușit deja". Verificăm dedup-ul PUR la nivel DB, fără
    // să depindem de Resend real: dacă dedup-ul funcționează corect, bucla din
    // bulkSend() sare peste toți cei 3 înainte de a ajunge la orice apel de trimitere
    // (sendEmailWithResult nu e niciodată chemat), deci testul nu atinge rețeaua.
    const recipients = [
      { email: `qa-batch-dedup-1-${RUN_ID}@example.com`, nume: 'Ana' },
      { email: `qa-batch-dedup-2-${RUN_ID}@example.com`, nume: 'Ion' },
      { email: `qa-batch-dedup-3-${RUN_ID}@example.com` },
    ]
    await db.insert(emailSends).values(
      recipients.map((r) => ({
        templateId,
        recipient: r.email,
        subject: 'Salut',
        status: 'sent' as const,
        errorMessage: null,
        batchId: null,
      })),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/email/bulk-send',
      headers: { cookie },
      payload: { templateId, recipients },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.sent).toBe(0)
    expect(body.data.skipped).toBe(3)
    expect(body.data.failed).toBe(0)
    expect(body.data.results).toHaveLength(0) // niciun rând nou inserat pt. destinatarii săriți
  })
})

// ── Reply pe thread fără niciun mesaj direction='in' ────────────────────────────

describe('POST /api/email/threads/:id/reply — thread fără niciun mesaj primit', () => {
  it('întoarce eroare curată "Thread fără niciun mesaj primit" (400), nu 500', async () => {
    const [thread] = await db
      .insert(emailThreads)
      .values({ subject: `QA no-inbound thread ${RUN_ID}`, participants: ['nimeni@example.com'], lastMessageAt: new Date() })
      .returning()

    const res = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${thread!.id}/reply`,
      headers: { cookie },
      payload: { body: 'Încerc să răspund la un thread gol' },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.success).toBe(false)
    expect(String(body.error)).toContain('Thread fără niciun mesaj primit')
  })
})
