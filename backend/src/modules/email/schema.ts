import { z } from 'zod'
import { updateSchema } from '../../shared/lib/update-schema.js'

// ── Templates ────────────────────────────────────────────────────────────────

export const TemplateCreateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  // Suportă placeholder {{nume}} — înlocuit la trimitere, nu la salvare.
  body: z.string().min(1),
})

export const TemplateUpdateSchema = updateSchema(TemplateCreateSchema)

export const TemplateIdParamsSchema = z.object({ id: z.string().uuid() })
export const UnsubscribeTokenParamsSchema = z.object({ token: z.string().min(1) })
export const SuppressionEmailParamsSchema = z.object({ email: z.string().trim().min(1) })
export const PlatformClientsParamsSchema = z.object({ platformId: z.string().uuid() })

// ── Send (1:1) ───────────────────────────────────────────────────────────────

// Identitatea "From" — cheie în lista de identități configurabile din Setări Email
// (sprint de-hardcodare 2026-08-25; fallback env pt. instalări proaspete). Validarea contra
// listei se face în service (resolveFromAddress), nu aici — schema rămâne un simplu string,
// la fel ca restul cheilor dinamice (bundle keys, addon keys).
export const EmailFromSchema = z.string().trim().min(1)

// Atașamente — content e base64 (encodat de frontend din File via FileReader).
// Limită per fișier ~15MB decodat (base64 ≈ 4/3 din original) — generoasă pt. un
// singur utilizator autentificat, dar nu nelimitată (vezi și bodyLimit din app.ts).
export const EmailAttachmentSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1).max(20_000_000),
})

export const SendCreateSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  templateId: z.string().uuid().optional(),
  from: EmailFromSchema.default('stefan'),
  attachments: z.array(EmailAttachmentSchema).max(5).optional(),
})

// ── Bulk send ────────────────────────────────────────────────────────────────

// Volum confirmat de Stefan: sub 50 destinatari per trimitere (decizie #4 din plan).
export const BulkSendRecipientSchema = z.object({
  email: z.string().email(),
  nume: z.string().optional(),
})

export const BulkSendSchema = z.object({
  templateId: z.string().uuid(),
  recipients: z.array(BulkSendRecipientSchema).min(1).max(50),
  from: EmailFromSchema.default('contact'),
  attachments: z.array(EmailAttachmentSchema).max(5).optional(),
})

// ── Sends (istoric) ──────────────────────────────────────────────────────────

// Filtrele din SentTab.tsx (sursă, secvență, perioadă) — bază comună pt. listă/raport/export,
// ca toate trei să rămână garantat în sincron (același set de rânduri stă la baza fiecăreia).
export const SendsFilterQuerySchema = z.object({
  // Filtru pt. tab-ul „Trimise" (SentTab.tsx) — manual (Compose 1:1, fără batch/enrollment),
  // secvență (drip automat) sau bulk. Mutual exclusiv prin construcție (vezi email-sends.ts):
  // sendSingle nu setează niciodată batchId/sequenceEnrollmentId, bulkSend setează doar batchId,
  // email-sequence-runner setează doar sequenceEnrollmentId.
  source: z.enum(['manual', 'sequence', 'bulk']).optional(),
  // Doar cu source:'sequence' — restrânge la o secvență anume (dropdown SentTab.tsx).
  sequenceId: z.string().uuid().optional(),
  // Doar cu source:'sequence' — engaged (deschis/click), unengaged (trimis, fără reacție) sau
  // dezabonat (email_suppressions), independent de status-ul de livrare.
  engagement: z.enum(['engaged', 'unengaged', 'unsubscribed']).optional(),
  // Perioadă — mirror PeriodQuerySchema din financials/metrics (duplicat intenționat, module
  // izolate, vezi CLAUDE.md regula #5).
  period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const SendsQuerySchema = SendsFilterQuerySchema.extend({
  templateId: z.string().uuid().optional(),
  recipient: z.string().optional(),
  // 2026-08-11 — filtrare pe un bulk-send anume (BulkSendTab.tsx persistă batchId în URL, ca
  // statusul detaliat per-destinatar să supraviețuiască unui refresh, nu doar în state local).
  batchId: z.string().uuid().optional(),
  // 2026-08-11 — filtrare pe MAI MULTE bulk-send-uri (listă separată prin virgulă) — Stefan
  // trimite liste succesive și vrea rezultatele acumulate, nu înlocuite la fiecare send nou.
  // String simplu (nu z.array) — query string rămâne un singur parametru, fără complicații de
  // parsare la chei repetate; UUID-urile invalide sunt filtrate silențios în service.ts.
  batchIds: z.string().optional(),
  // 2026-09-03 — căutare liberă în SentTab.tsx (destinatar/subiect/expeditor), ILIKE substring
  // — nu era deloc, Stefan trebuia să parcurgă manual paginile.
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})

// 2026-08-11 — BulkSendTab.tsx seedează `batchIds` din URL cu astea la prima încărcare (fără
// URL special) — Stefan a întrebat de ce nu vede istoricul bulk "în mod normal".
export const RecentBatchesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
})
