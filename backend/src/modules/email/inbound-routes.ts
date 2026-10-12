import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { Webhook, WebhookVerificationError } from 'svix'
import { config } from '../../shared/config.js'
import { requireIngestToken } from '../../shared/middleware/auth.js'
import { readDocument } from '../../shared/lib/storage.js'
import {
  AttachmentIdParamsSchema,
  BulkUpdateSchema,
  CloudflareInboundWebhookSchema,
  DeliveryStatusEventSchema,
  ForwardSchema,
  MessageIdParamsSchema,
  MessagePatchSchema,
  ThreadIdParamsSchema,
  ThreadReplySchema,
  ThreadsQuerySchema,
} from './inbound-schema.js'
import * as inboundService from './inbound-service.js'
import { MailboxForbidden } from './mailboxes.js'
import { recordEngagementEvent, updateSendStatusFromWebhook, type DeliveryStatus } from './service.js'

// Mapare tip eveniment Resend → statusul nostru intern (email_sends.status).
const DELIVERY_STATUS_BY_EVENT: Record<string, DeliveryStatus> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'failed',
}

// 2026-08-11 — email.opened/email.clicked (Stefan vrea să vadă CINE deschide/dă click pe
// campanii, nu doar un status agregat) — ramură separată de status-urile de livrare de mai sus
// (nu suprascriu email_sends.status, doar contoare + timestamp de engagement).
const ENGAGEMENT_EVENT_BY_TYPE: Record<string, 'opened' | 'clicked'> = {
  'email.opened': 'opened',
  'email.clicked': 'clicked',
}

/** Extrage un mesaj de motiv (bounce/complaint) din payload, dacă e prezent — best-effort,
 *  forma exactă a sub-obiectului variază pe tip de eveniment și nu e documentată strict aici. */
function extractReason(data: Record<string, unknown>): string | null {
  const bounce = data.bounce as { message?: string } | undefined
  if (bounce?.message) return bounce.message
  const complaint = data.complaint as { feedbackType?: string } | undefined
  if (complaint?.feedbackType) return `Complaint: ${complaint.feedbackType}`
  return null
}

/** Link-ul dat click, pt. email.clicked — best-effort, forma exactă a `data.click` nu e
 *  documentată strict de Resend; absența lui nu blochează înregistrarea evenimentului. */
function extractClickedUrl(data: Record<string, unknown>): string | null {
  const click = data.click as { link?: string } | undefined
  return click?.link ?? null
}

// Rutele de inbound (primire) ale modulului Email — separate de `routes.ts` (BE:
// templates/send/bulk-send/sends), ca să nu se suprapună diff-urile la merge (vezi
// notă în routes.ts). Conține rute publice (fără JWT, autentificate altfel):
// webhook-ul Resend (semnătură Svix — Resend nu poate trimite cookie-ul de sesiune
// al lui Stefan) și webhook-ul Cloudflare Email Routing (token dedicat).

const INLINE_ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'])

const SVIX_HEADER_NAMES = ['svix-id', 'svix-timestamp', 'svix-signature'] as const

function extractSvixHeaders(headers: Record<string, unknown>): Record<string, string> | null {
  const result: Record<string, string> = {}
  for (const name of SVIX_HEADER_NAMES) {
    const value = headers[name]
    if (typeof value !== 'string' || value.length === 0) return null
    result[name] = value
  }
  return result
}

export async function emailInboundRoutes(app: FastifyInstance) {
  // ── Webhook Resend — status livrare trimiteri (PUBLIC, fără authenticate) ──
  // Receiving mail through Resend was dropped for cost; Cloudflare Email Routing (below)
  // took its place. This route stayed and now only tracks the delivery status of what we send
  // (email_sends.status): Resend is still the sending provider.
  // Svix verifies the raw body, not re-serialized JSON, hence the buffer parser. It is
  // registered in its own Fastify context, so every other route keeps the default JSON parser.
  await app.register(async (instance) => {
    instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.post('/api/webhooks/resend-inbound', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
      if (!config.resendWebhookSecret) {
        req.log.error('[email] RESEND_WEBHOOK_SECRET neconfigurat — webhook respins (fail-closed)')
        return reply.code(503).send({ success: false, error: 'Webhook neconfigurat' })
      }

      const svixHeaders = extractSvixHeaders(req.headers as Record<string, unknown>)
      if (!svixHeaders) {
        return reply.code(400).send({ success: false, error: 'Headere Svix lipsă' })
      }

      const rawBody = req.body
      if (!Buffer.isBuffer(rawBody)) {
        return reply.code(400).send({ success: false, error: 'Body invalid' })
      }

      let verifiedPayload: unknown
      try {
        verifiedPayload = new Webhook(config.resendWebhookSecret).verify(rawBody, svixHeaders)
      } catch (err) {
        if (err instanceof WebhookVerificationError) {
          req.log.warn(`[email] semnătură webhook invalidă: ${err.message}`)
        } else {
          req.log.warn(`[email] verificare webhook eșuată: ${String(err)}`)
        }
        return reply.code(401).send({ success: false, error: 'Semnătură invalidă' })
      }

      // De aici încolo payload-ul e AUTENTIC (semnat de Resend) — procesarea propriu-zisă
      // e izolată (regula #7 CLAUDE.md): orice eroare de parsare/ingest e logată în
      // sync_log, nu propagată. Răspundem 200 oricum, ca Resend să nu reîncerce la nesfârșit
      // un payload pe care structural nu-l putem trata (ex: eveniment neurmărit).
      const envelope = verifiedPayload as { type?: unknown }
      const deliveryStatus = typeof envelope.type === 'string' ? DELIVERY_STATUS_BY_EVENT[envelope.type] : undefined
      if (deliveryStatus) {
        const parsedStatus = DeliveryStatusEventSchema.safeParse(verifiedPayload)
        if (!parsedStatus.success) {
          req.log.warn(`[email] payload status livrare cu formă neașteptată: ${parsedStatus.error.message}`)
          return reply.code(200).send({ received: true })
        }
        try {
          await updateSendStatusFromWebhook(
            parsedStatus.data.data.email_id,
            deliveryStatus,
            extractReason(parsedStatus.data.data),
          )
        } catch (err) {
          req.log.error(`[email] update status livrare eșuat: ${String(err)}`)
        }
        return reply.code(200).send({ received: true })
      }

      const engagementType = typeof envelope.type === 'string' ? ENGAGEMENT_EVENT_BY_TYPE[envelope.type] : undefined
      if (engagementType) {
        const parsedEngagement = DeliveryStatusEventSchema.safeParse(verifiedPayload)
        if (!parsedEngagement.success) {
          req.log.warn(`[email] payload engagement cu formă neașteptată: ${parsedEngagement.error.message}`)
          return reply.code(200).send({ received: true })
        }
        try {
          await recordEngagementEvent(
            parsedEngagement.data.data.email_id,
            engagementType,
            engagementType === 'clicked' ? extractClickedUrl(parsedEngagement.data.data) : null,
          )
        } catch (err) {
          req.log.error(`[email] înregistrare engagement eșuată: ${String(err)}`)
        }
        return reply.code(200).send({ received: true })
      }

      // Alt tip de eveniment decât cele urmărite — ignorăm silențios.
      return reply.code(200).send({ received: true })
    })
  })

  // ── Threads / inbox (authenticate) ────────────────────────────────────────
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Webhook Cloudflare Email Routing (Sprint D, Track 5, machine-to-machine) ──
  // Apelant: Worker-ul infra/cloudflare-email-worker/, NU un browser — secret dedicat
  // (X-Cloudflare-Email-Token), fail-closed, pattern identic host-metrics
  // (monitoring/routes.ts). Worker-ul NU retrimite la eșec (Cloudflare Email Routing
  // n-are retry nativ), deci handler-ul răspunde întotdeauna cu un status clar și NU
  // aruncă mai departe din service (regula #7 CLAUDE.md).
  server.post(
    '/api/webhooks/cloudflare-inbound',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      onRequest: requireIngestToken('X-Cloudflare-Email-Token', () => config.cloudflareEmailIngestToken, 'CLOUDFLARE_EMAIL_INGEST_TOKEN'),
      schema: { body: CloudflareInboundWebhookSchema },
    },
    async (req) => {
      await inboundService.processCloudflareInboundWebhookEvent(req.body)
      return { success: true }
    },
  )

  server.get(
    '/api/email/threads',
    { preHandler: [app.authenticate], schema: { querystring: ThreadsQuerySchema } },
    async (req) => {
      const [items, total] = await Promise.all([
        inboundService.listThreads(req.me, req.query),
        inboundService.countThreads(req.me, req.query),
      ])
      return { success: true, data: { items, total } }
    },
  )

  server.get('/api/email/unread-counts', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await inboundService.getUnreadCounts(req.me) }
  })

  // Autocomplete la Compose — adrese cu care Stefan a corespondat recent (trimise + primite).
  server.get('/api/email/recent-addresses', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await inboundService.getRecentAddresses() }
  })

  server.get(
    '/api/email/threads/:id',
    { preHandler: [app.authenticate], schema: { params: ThreadIdParamsSchema } },
    async (req, reply) => {
      const result = await inboundService.getThreadWithMessages(req.me, req.params.id)
      if (!result) return reply.code(404).send({ success: false, error: 'Thread not found' })
      return { success: true, data: result }
    },
  )

  server.post(
    '/api/email/threads/:id/reply',
    { preHandler: [app.authenticate], schema: { params: ThreadIdParamsSchema, body: ThreadReplySchema } },
    async (req, reply) => {
      try {
        const message = await inboundService.replyToThread(req.me, req.params.id, req.body.body, req.body.attachments, {
          lastSeenMessageId: req.body.lastSeenMessageId,
        })
        return reply.code(201).send({ success: true, data: message })
      } catch (err) {
        // Răspuns dublu: 409 cu cine a răspuns între timp, ca frontendul să poată arăta
        // „Ion a răspuns acum 3 min" și să lase omul să trimită oricum.
        if (err instanceof Error && (err as { code?: string }).code === 'THREAD_REPLIED_MEANWHILE') {
          const e = err as unknown as { by: string | null; at: Date }
          return reply.code(409).send({ success: false, error: { code: 'THREAD_REPLIED_MEANWHILE', by: e.by, at: e.at } })
        }
        // Răspunsul pleacă de pe cutia firului: dacă aceea nu e a omului, e tot un refuz de
        // cutie (403), nu o eroare de validare — altfel frontendul n-ar ști ce să arate.
        if (err instanceof MailboxForbidden) {
          return reply.code(403).send({ success: false, error: { code: err.code, feature: err.fromKey } })
        }
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── Acțiuni de mailbox (patch/bulk/forward/attachment) — Wave 1 BE ─────────

  server.patch(
    '/api/email/messages/:id',
    { preHandler: [app.authenticate], schema: { params: MessageIdParamsSchema, body: MessagePatchSchema } },
    async (req, reply) => {
      const message = await inboundService.patchMessage(req.me, req.params.id, req.body)
      if (!message) return reply.code(404).send({ success: false, error: 'Message not found' })
      return { success: true, data: message }
    },
  )

  server.post(
    '/api/email/messages/bulk-update',
    { preHandler: [app.authenticate], schema: { body: BulkUpdateSchema } },
    async (req) => {
      const affected = await inboundService.bulkUpdateMessages(req.me, req.body.ids, req.body.patch)
      return { success: true, data: { affected } }
    },
  )

  server.post(
    '/api/email/messages/:id/forward',
    { preHandler: [app.authenticate], schema: { params: MessageIdParamsSchema, body: ForwardSchema } },
    async (req, reply) => {
      try {
        const message = await inboundService.forwardMessage(req.me, req.params.id, req.body)
        return reply.code(201).send({ success: true, data: message })
      } catch (err) {
        if (err instanceof MailboxForbidden) {
          return reply.code(403).send({ success: false, error: { code: err.code, feature: err.fromKey } })
        }
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.get(
    '/api/email/attachments/:id/download',
    { preHandler: [app.authenticate], schema: { params: AttachmentIdParamsSchema } },
    async (req, reply) => {
      const attachment = await inboundService.getMessageAttachment(req.me, req.params.id)
      if (!attachment) return reply.code(404).send({ success: false, error: 'Attachment not found' })
      const content = await readDocument(attachment.storagePath)
      // The sender picks the type and the name. Only plain images and PDFs open in the tab;
      // anything else (HTML, SVG) would render on this origin, next to the session cookie.
      const inline = INLINE_ATTACHMENT_TYPES.has(attachment.contentType ?? '')
      const filename = attachment.filename.replace(/[\u0000-\u001f\u007f"\\]/g, '_')
      return reply
        .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .type(inline ? (attachment.contentType as string) : 'application/octet-stream')
        .send(content)
    },
  )
}
