import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { escapeHtml } from './signature.js'
import {
  BulkSendSchema,
  PlatformClientsParamsSchema,
  RecentBatchesQuerySchema,
  SendCreateSchema,
  SendsFilterQuerySchema,
  SendsQuerySchema,
  SuppressionEmailParamsSchema,
  TemplateCreateSchema,
  TemplateIdParamsSchema,
  TemplateUpdateSchema,
  UnsubscribeTokenParamsSchema,
} from './schema.js'
import * as service from './service.js'
import { MailboxForbidden } from './mailboxes.js'
import { getSuppressionsOverview, removeSuppression, suppressEmail } from './unsubscribe-service.js'
import { verifyUnsubscribeToken } from './unsubscribe-token.js'
import { tr } from '../../shared/lib/i18n.js'

const UNSUBSCRIBE_PAGE_STYLE = 'font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#1a1a1a;line-height:1.5'

function unsubscribePage(message: string): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Dezabonare</title></head><body style="${UNSUBSCRIBE_PAGE_STYLE}"><h1 style="font-size:1.25rem">${message}</h1></body></html>`
}

// Rutele din secțiunea asta (templates / send / bulk-send / sends) sunt ale BE.
// Agentul Integrations adaugă separat, în același modul, webhook-ul de inbound
// (`POST /api/webhooks/resend-inbound` — public, fără authenticate, vezi PLAN.md)
// și rutele de threads/inbox — de preferat într-un fișier propriu
// (ex. `modules/email/inbound-routes.ts`) sau într-o secțiune clar demarcată aici,
// ca să nu se suprapună diff-urile la merge.

export async function emailRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Templates ────────────────────────────────────────────────────────────

  server.get('/api/email/templates', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listTemplates() }
  })

  server.post(
    '/api/email/templates',
    { preHandler: [app.authenticate], schema: { body: TemplateCreateSchema } },
    async (req, reply) => {
      return reply.code(201).send({ success: true, data: await service.createTemplate(req.body) })
    },
  )

  server.patch(
    '/api/email/templates/:id',
    { preHandler: [app.authenticate], schema: { params: TemplateIdParamsSchema, body: TemplateUpdateSchema } },
    async (req, reply) => {
      const template = await service.updateTemplate(req.params.id, req.body)
      if (!template) return reply.code(404).send({ success: false, error: 'Template not found' })
      return { success: true, data: template }
    },
  )

  server.delete(
    '/api/email/templates/:id',
    { preHandler: [app.authenticate], schema: { params: TemplateIdParamsSchema } },
    async (req, reply) => {
      const deleted = await service.softDeleteTemplate(req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Template not found' })
      return { success: true }
    },
  )

  // ── Send (1:1) ───────────────────────────────────────────────────────────

  server.post(
    '/api/email/send',
    { preHandler: [app.authenticate], schema: { body: SendCreateSchema } },
    async (req, reply) => {
      try {
        const result = await service.sendSingle(req.me, req.body)
        return reply.code(201).send({ success: true, data: result })
      } catch (err) {
        if (err instanceof MailboxForbidden) {
          return reply.code(403).send({ success: false, error: { code: err.code, feature: err.fromKey } })
        }
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── Bulk send ────────────────────────────────────────────────────────────

  server.get(
    '/api/email/platform-clients/:platformId',
    { preHandler: [app.authenticate], schema: { params: PlatformClientsParamsSchema } },
    async (req) => {
      return { success: true, data: await service.listPlatformClientRecipients(req.params.platformId) }
    },
  )

  server.post(
    '/api/email/bulk-send',
    { preHandler: [app.authenticate], schema: { body: BulkSendSchema } },
    async (req, reply) => {
      try {
        const result = await service.bulkSend(req.me, req.body)
        return { success: true, data: result }
      } catch (err) {
        if (err instanceof MailboxForbidden) {
          return reply.code(403).send({ success: false, error: { code: err.code, feature: err.fromKey } })
        }
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── Sends (istoric) ──────────────────────────────────────────────────────

  server.get(
    '/api/email/sends',
    { preHandler: [app.authenticate], schema: { querystring: SendsQuerySchema } },
    async (req) => {
      return { success: true, data: await service.listSends(req.query) }
    },
  )

  server.get(
    '/api/email/sends/recent-batches',
    { preHandler: [app.authenticate], schema: { querystring: RecentBatchesQuerySchema } },
    async (req) => {
      return { success: true, data: await service.getRecentBatchIds(req.query.limit) }
    },
  )

  server.get(
    '/api/email/sends/report',
    { preHandler: [app.authenticate], schema: { querystring: SendsFilterQuerySchema } },
    async (req) => {
      return { success: true, data: await service.getSendsReport(req.query) }
    },
  )

  server.get(
    '/api/email/sends/export',
    { preHandler: [app.authenticate], schema: { querystring: SendsFilterQuerySchema } },
    async (req, reply) => {
      const csv = await service.exportSendsCsv(req.query)
      return reply.type('text/csv').header('Content-Disposition', 'attachment; filename="email-sends.csv"').send(csv)
    },
  )

  server.get('/api/email/send-quota', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getSendQuotaUsage() }
  })

  server.get('/api/email/suppressions-overview', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await getSuppressionsOverview() }
  })

  // Manual removal; see removeSuppression in unsubscribe-service.ts for when it is needed.
  server.delete(
    '/api/email/suppressions/:email',
    { preHandler: [app.authenticate], schema: { params: SuppressionEmailParamsSchema } },
    async (req, reply) => {
      const removed = await removeSuppression(req.params.email)
      if (!removed) return reply.code(404).send({ success: false, error: tr('errors.email.suppressionNotFound') })
      return { success: true }
    },
  )

  // ── Unsubscribe (PUBLIC, fără authenticate — click dintr-un client de mail) ─
  // Singura rută din modul fără sesiune Stefan. Token stateless (unsubscribe-token.ts) — nu
  // verificăm decât semnătura HMAC, niciun secret nu ajunge în răspuns. Rate-limit ca la
  // celelalte rute publice (webhooks/vanagreen-alert) — token-urile sunt greu de ghicit
  // (HMAC), dar tot merită o plasă împotriva scanării.
  server.get(
    '/api/email/unsubscribe/:token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: UnsubscribeTokenParamsSchema },
    },
    async (req, reply) => {
      const email = verifyUnsubscribeToken(req.params.token)
      if (!email) {
        return reply.code(400).type('text/html').send(unsubscribePage('Link invalid sau expirat.'))
      }

      try {
        await suppressEmail(email)
      } catch (err) {
        req.log.error({ err }, `[email] unsubscribe eșuat pentru ${email}`)
        return reply.code(500).type('text/html').send(unsubscribePage('A apărut o eroare — încearcă din nou mai târziu.'))
      }

      return reply.type('text/html').send(unsubscribePage(`Adresa ${escapeHtml(email)} a fost dezabonată. Nu vei mai primi acest tip de email.`))
    },
  )

  // One-click unsubscribe (RFC 8058, header `List-Unsubscribe-Post` trimis de bulkSend) —
  // clientul de mail (ex: chip-ul "Unsubscribe" din Gmail lângă numele expeditorului) face
  // POST direct pe URL, fără să deschidă vreun tab/pagină — nu-i arată niciodată răspunsul,
  // deci nu are rost HTML aici, doar statusul. Fără asta, chip-ul nativ nu apare deloc.
  server.post(
    '/api/email/unsubscribe/:token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: UnsubscribeTokenParamsSchema },
    },
    async (req, reply) => {
      const email = verifyUnsubscribeToken(req.params.token)
      if (!email) return reply.code(400).send()

      try {
        await suppressEmail(email)
      } catch (err) {
        req.log.error({ err }, `[email] one-click unsubscribe eșuat pentru ${email}`)
        return reply.code(500).send()
      }

      return reply.code(200).send()
    },
  )
}
