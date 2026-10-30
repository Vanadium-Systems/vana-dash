import { z } from 'zod'

// ── Webhook Resend — status livrare (email.sent/delivered/bounced/complained/delivery_delayed) ──
// Payload-ul exact per tip de eveniment variază (bounce/complaint au sub-obiecte
// proprii) — schema e permisivă (`passthrough`) și extragem doar `email_id`, restul
// îl citim defensiv la nevoie (vezi inbound-routes.ts), niciodată respins la parsare.
export const DeliveryStatusEventSchema = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string().min(1) }).passthrough(),
})

// ── Webhook Cloudflare Email Routing (Sprint D, Track 5) ─────────────────────
// Spre deosebire de Resend, payload-ul conține conținutul COMPLET dintr-un singur POST
// (Worker-ul parsează raw MIME cu postal-mime) — nu doar o notificare. `inReplyTo`/
// `references` nu sunt persistate încă (schema n-are coloane pt. ele) — acceptate în
// payload pt. compat viitoare, ignorate la ingest (vezi inbound-service.ts).
export const CloudflareInboundWebhookSchema = z.object({
  from: z.string().min(1),
  // Header Reply-To real, dacă diferă de From (comun la trimițători bulk) — vezi bug
  // fromAddress=envelope, 2026-07-24, în inbound-service.ts.
  replyTo: z.string().nullable().optional(),
  to: z.string().min(1),
  subject: z.string().default(''),
  text: z.string().nullable().default(null),
  html: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  inReplyTo: z.string().nullable().optional(),
  references: z.string().nullable().optional(),
  // Rezultatul DMARC de la MX-ul Cloudflare (`pass` / `fail` / `none`…), extras de Worker.
  dmarc: z.string().nullable().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentType: z.string().nullable().default(null),
        contentBase64: z.string(),
        // Sprint 3 — leagă <img src="cid:X"> din html de atașamentul inline corespunzător.
        contentId: z.string().nullable().optional(),
        disposition: z.enum(['attachment', 'inline']).nullable().optional(),
      }),
    )
    .default([]),
})

// ── Threads (authenticate) ─────────────────────────────────────────────────────

export const ThreadIdParamsSchema = z.object({ id: z.string().uuid() })

export const ThreadReplySchema = z.object({
  body: z.string().min(1),
  attachments: z
    .array(z.object({ filename: z.string().min(1), content: z.string().min(1) }))
    .max(5)
    .optional(),
  // Ultimul mesaj pe care omul l-a văzut înainte să scrie. Dacă între timp a plecat alt
  // răspuns pe fir, serverul răspunde 409 THREAD_REPLIED_MEANWHILE (decizie Stefan,
  // 2026-09-28) — fără lock-uri și fără „cine scrie acum".
  lastSeenMessageId: z.string().uuid().nullish(),
})

// Filtre de listare — paritate Gmail (foldere/label/search/starred), PLAN.md Wave 1.
export const ThreadsQuerySchema = z.object({
  folder: z.enum(['inbox', 'archive', 'trash', 'spam', 'all']).optional(),
  labelId: z.string().uuid().optional(),
  // 2026-09-03 — filtru „pe ce adresă am primit" (Stefan are mai multe identități de recepție:
  // stefan@, contact@, outreach@ etc.) — pe adresa TO a mesajelor inbound din thread, nu pe from.
  toAddress: z.string().trim().min(1).optional(),
  q: z.string().min(1).optional(),
  isStarred: z.coerce.boolean().optional(),
  hasAttachment: z.coerce.boolean().optional(),
  // Vedere dedicată "Amânate" (snooze) — ignoră `folder` când e prezent (mesajele amânate pot
  // fi din orice folder de bază). Fără el, `folder=inbox` exclude implicit ce e amânat acum.
  snoozed: z.coerce.boolean().optional(),
  sort: z.enum(['date_desc', 'date_asc', 'subject_asc']).default('date_desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// ── Mesaje individuale — acțiuni de mailbox (Wave 1 BE) ───────────────────────

export const ThreadReadStateQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.string().uuid()).max(100)),
})

export const MessageIdParamsSchema = z.object({ id: z.string().uuid() })
export const AttachmentIdParamsSchema = z.object({ id: z.string().uuid() })

export const MessagePatchSchema = z.object({
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  folder: z.enum(['inbox', 'archive', 'trash', 'spam']).optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  labelId: z.string().uuid().nullable().optional(),
})

export const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  patch: z.object({
    isRead: z.boolean().optional(),
    folder: z.enum(['inbox', 'archive', 'trash', 'spam']).optional(),
    snoozedUntil: z.string().datetime().nullable().optional(),
    labelId: z.string().uuid().nullable().optional(),
  }),
})

export const ForwardSchema = z.object({
  to: z.string().email(),
  extraBody: z.string().optional(),
  includeOriginalAttachments: z.boolean().default(false),
  attachments: z
    .array(z.object({ filename: z.string().min(1), content: z.string().min(1) }))
    .max(5)
    .optional(),
})
