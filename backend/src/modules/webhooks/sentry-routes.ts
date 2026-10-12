import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { config } from '../../shared/config.js'
import { safeEqual } from '../../shared/lib/crypto.js'
import { handleSentryIssueWebhook } from './sentry-service.js'

/**
 * Webhook Sentry — `POST /api/webhooks/sentry` (PUBLIC, fără session/JWT — Sentry nu poate
 * trimite cookie-ul lui Stefan). Semnătură HMAC-SHA256 peste raw body, header
 * `Sentry-Hook-Signature`, secret = Client Secret-ul integrării (Internal Integration sau
 * legacy WebHooks) configurate în dashboard-ul Sentry — vezi docs/API.md pt. pașii de setup.
 *
 * Content-type parser custom, încapsulat DOAR pe ruta asta (context Fastify separat, pattern
 * identic `modules/email/inbound-routes.ts` pt. webhook-ul Resend) — HMAC-ul trebuie calculat
 * pe body-ul RAW, nu pe JSON re-serializat.
 */
export async function sentryWebhookRoutes(app: FastifyInstance) {
  await app.register(async (instance) => {
    instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    // The signature is checked on the raw body, so the body is read before we know who sent it.
    instance.post('/api/webhooks/sentry', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
      if (!config.sentryWebhookSecret) {
        req.log.error('[webhooks/sentry] SENTRY_WEBHOOK_SECRET neconfigurat — webhook respins (fail-closed)')
        return reply.code(503).send({ success: false, error: 'Webhook neconfigurat' })
      }

      const signature = req.headers['sentry-hook-signature']
      if (typeof signature !== 'string' || signature.length === 0) {
        return reply.code(400).send({ success: false, error: 'Header Sentry-Hook-Signature lipsă' })
      }

      const rawBody = req.body
      if (!Buffer.isBuffer(rawBody)) {
        return reply.code(400).send({ success: false, error: 'Body invalid' })
      }

      const expected = createHmac('sha256', config.sentryWebhookSecret).update(rawBody).digest('hex')
      if (!safeEqual(signature, expected)) {
        req.log.warn('[webhooks/sentry] semnătură invalidă')
        return reply.code(401).send({ success: false, error: 'Semnătură invalidă' })
      }

      let payload: unknown
      try {
        payload = JSON.parse(rawBody.toString('utf8'))
      } catch {
        return reply.code(400).send({ success: false, error: 'JSON invalid' })
      }

      // Payload AUTENTIC de aici încolo — procesare izolată (regula #7 CLAUDE.md): o eroare
      // de extracție/alertare nu trebuie să facă Sentry să reîncerce la nesfârșit un payload
      // pe care structural nu-l putem trata. Logăm payload-ul brut (trunchiat) la fiecare
      // livrare cât timp integrarea e nouă — utile ca să verificăm dacă extracția (formă
      // presupusă, nevalidată live) chiar potrivește payload-ul real trimis de Sentry.
      req.log.info({ sentryPayload: JSON.stringify(payload).slice(0, 2000) }, '[webhooks/sentry] payload primit')
      try {
        await handleSentryIssueWebhook(payload)
      } catch (err) {
        req.log.error(`[webhooks/sentry] procesare eșuată: ${String(err)}`)
      }

      return reply.code(200).send({ received: true })
    })
  })
}
