/**
 * POST /api/webhooks/cloudflare-inbound (Sprint D, Track 5) — auth fail-closed +
 * validare payload la nivel HTTP. `ingestCloudflareInboundEmail` are propriile teste
 * exhaustive în inbound-service.test.ts; aici verificăm doar GRANIȚA rutei (token
 * lipsă/greșit/neconfigurat, body invalid), care nu poate fi exercitată din service.
 */
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { emailAttachments, emailMessages, emailThreads, syncLog } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

afterAll(async () => {
  await app.close()
})

const VALID_TOKEN = config.cloudflareEmailIngestToken

function validPayload(subject: string) {
  return {
    from: 'cineva@extern.ro',
    to: 'stefan@vanadium.systems',
    subject,
    text: 'corp',
    html: null,
    messageId: `<${Math.random().toString(36).slice(2)}@extern.ro>`,
    attachments: [],
  }
}

describe('POST /api/webhooks/cloudflare-inbound — auth fail-closed', () => {
  it('rejects with 401 when the X-Cloudflare-Email-Token header is missing entirely', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/cloudflare-inbound',
      payload: validPayload('QA no-token'),
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects with 401 when the token is present but wrong', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/cloudflare-inbound',
      headers: { 'x-cloudflare-email-token': 'wrong-token-entirely' },
      payload: validPayload('QA wrong-token'),
    })
    expect(res.statusCode).toBe(401)
  })

  it('accepts and ingests with the correct token (test/setup.ts pins a fixed value)', async () => {
    // Dacă CLOUDFLARE_EMAIL_INGEST_TOKEN nu e pinat în test/setup.ts, ruta e fail-closed
    // (config gol => 401 mereu) — verificăm asta explicit, nu presupunem.
    if (!VALID_TOKEN) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/cloudflare-inbound',
        headers: { 'x-cloudflare-email-token': 'anything' },
        payload: validPayload('QA unconfigured'),
      })
      expect(res.statusCode).toBe(401)
      return
    }

    const subject = 'QA correct-token'
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/cloudflare-inbound',
      headers: { 'x-cloudflare-email-token': VALID_TOKEN },
      payload: validPayload(subject),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, subject))
    expect(thread).toBeDefined()
    await db.delete(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    await db.delete(emailThreads).where(eq(emailThreads.id, thread!.id))
    await db.delete(syncLog).where(and(eq(syncLog.jobKey, 'email:cloudflare-inbound')))
  })
})

describe('POST /api/webhooks/cloudflare-inbound — Sprint 3 (bodyHtml + contentId/disposition)', () => {
  it('bodyHtml și contentId/disposition pe atașamente SUPRAVIEȚUIESC validării Zod la nivel HTTP (regression: schema trebuie ținută sincron cu CloudflareInboundPayload)', async () => {
    if (!VALID_TOKEN) return
    const subject = 'QA schema passthrough bodyHtml+cid'
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/cloudflare-inbound',
      headers: { 'x-cloudflare-email-token': VALID_TOKEN },
      payload: {
        ...validPayload(subject),
        html: '<p>html real</p><img src="cid:logo123">',
        attachments: [
          {
            filename: 'logo.png',
            contentType: 'image/png',
            contentBase64: Buffer.from('fake').toString('base64'),
            contentId: 'logo123',
            disposition: 'inline',
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(message?.bodyHtml).toBe('<p>html real</p><img src="cid:logo123">')

    const attachments = await db.select().from(emailAttachments).where(eq(emailAttachments.messageId, message!.id))
    expect(attachments[0]?.contentId).toBe('logo123')
    expect(attachments[0]?.disposition).toBe('inline')

    await db.delete(emailAttachments).where(eq(emailAttachments.messageId, message!.id))
    await db.delete(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    await db.delete(emailThreads).where(eq(emailThreads.id, thread!.id))
    await db.delete(syncLog).where(and(eq(syncLog.jobKey, 'email:cloudflare-inbound')))
  })
})

describe('POST /api/webhooks/cloudflare-inbound — payload validation', () => {
  it('rejects with 400 when required fields are missing (e.g. "from")', async () => {
    if (!VALID_TOKEN) return // fail-closed deja acoperit mai sus — nu are sens fără token valid
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/cloudflare-inbound',
      headers: { 'x-cloudflare-email-token': VALID_TOKEN },
      payload: { to: 'stefan@vanadium.systems', attachments: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects with 400 when attachments have the wrong shape (contentBase64 missing)', async () => {
    if (!VALID_TOKEN) return
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/cloudflare-inbound',
      headers: { 'x-cloudflare-email-token': VALID_TOKEN },
      payload: { ...validPayload('QA bad attachment'), attachments: [{ filename: 'x.txt' }] },
    })
    expect(res.statusCode).toBe(400)
  })
})
