/**
 * Integration test — webhook Resend de status livrare (email.delivered/bounced),
 * separat de email-inbound.integration.test.ts (care acoperă email.received).
 * Verifică update-ul pe email_sends.status/errorMessage prin ruta publică semnată.
 */
import { eq } from 'drizzle-orm'
import argon2 from 'argon2'
import { Webhook } from 'svix'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { config } from '../src/shared/config.js'
import { db, sql } from '../src/shared/db/client.js'
import { emailSends, emailTemplates, users, roles } from '../src/shared/db/schema/index.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const RUN_ID = Date.now()
const TEST_EMAIL = `test-delivery-${RUN_ID}@test.local`
const TEST_PASSWORD = 'parola-de-test-123'
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
    displayName: 'Test Delivery',
    roleId: adminRoleId,
  })
  const [tpl] = await db
    .insert(emailTemplates)
    .values({ name: `Delivery status ${RUN_ID}`, subject: 'Subiect test', body: 'Corp test' })
    .returning()
  templateId = tpl!.id

  app = await buildServer()
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
  })
  const setCookie = res.headers['set-cookie']
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string)
  cookie = cookieStr.split(';')[0]!
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL))
  await db.delete(emailSends).where(eq(emailSends.templateId, templateId))
  await db.delete(emailTemplates).where(eq(emailTemplates.id, templateId))
  await app.close()
  await sql.end()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/webhooks/resend-inbound — status livrare outbound', () => {
  it('email.delivered actualizează rândul email_sends corespunzător (match pe resend_email_id)', async () => {
    const resendId = `resend-${RUN_ID}-1`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: resendId }), { status: 200 })),
    )

    const sendRes = await app.inject({
      method: 'POST',
      url: '/api/email/send',
      headers: { cookie },
      payload: { to: 'client@example.com', subject: 'Salut', body: 'Test', from: 'stefan' },
    })
    expect(sendRes.statusCode).toBe(201)
    expect(sendRes.json().data.status).toBe('sent')

    const { payload, headers } = signedRequest(
      { type: 'email.delivered', data: { email_id: resendId } },
      `msg_delivered_${RUN_ID}`,
    )
    const webhookRes = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    expect(webhookRes.statusCode).toBe(200)

    const [row] = await db.select().from(emailSends).where(eq(emailSends.resendEmailId, resendId))
    expect(row!.status).toBe('delivered')
  })

  it('email.bounced marchează rândul ca respins și salvează motivul', async () => {
    const resendId = `resend-${RUN_ID}-2`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: resendId }), { status: 200 })),
    )

    await app.inject({
      method: 'POST',
      url: '/api/email/send',
      headers: { cookie },
      payload: { to: 'bounce@example.com', subject: 'Salut', body: 'Test', from: 'stefan' },
    })

    const { payload, headers } = signedRequest(
      { type: 'email.bounced', data: { email_id: resendId, bounce: { message: 'Mailbox does not exist' } } },
      `msg_bounced_${RUN_ID}`,
    )
    const webhookRes = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    expect(webhookRes.statusCode).toBe(200)

    const [row] = await db.select().from(emailSends).where(eq(emailSends.resendEmailId, resendId))
    expect(row!.status).toBe('bounced')
    expect(row!.errorMessage).toBe('Mailbox does not exist')
  })

  it('un email_id necunoscut (fără rând corespunzător) e no-op, nu eroare', async () => {
    const { payload, headers } = signedRequest(
      { type: 'email.delivered', data: { email_id: `no-such-row-${RUN_ID}` } },
      `msg_unknown_${RUN_ID}`,
    )
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/resend-inbound', payload, headers })
    expect(res.statusCode).toBe(200)
  })
})
