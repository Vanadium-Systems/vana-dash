import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { billingClients, emailMessages, emailSends, emailSequenceEnrollments, emailSequences, emailSuppressions, emailTemplates } from '../../shared/db/schema/index.js'
import { getResendSentCount, sendEmailWithResult, type SendEmailResult } from '../../shared/lib/email.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { assertCanSendFrom } from './mailboxes.js'
import { resolvePeriod } from '../../shared/lib/period.js'
import { wrapBulkCampaignHtml } from './campaign-layout.js'
import { htmlToPlainText } from './html-to-text.js'
import { inlineStoredImages } from './images-service.js'
import { mirrorOutboundMessage } from './inbound-service.js'
import { getEmailSettings, getIdentities } from './settings-service.js'
import { buildSignature, escapeHtml } from './signature.js'
import { buildUnsubscribeToken } from './unsubscribe-token.js'
import { getSuppressedEmails, suppressEmail } from './unsubscribe-service.js'
import type {
  BulkSendSchema,
  EmailAttachmentSchema,
  EmailFromSchema,
  SendCreateSchema,
  SendsFilterQuerySchema,
  SendsQuerySchema,
  TemplateCreateSchema,
  TemplateUpdateSchema,
} from './schema.js'
import { getCompany } from '../../shared/lib/company.js'
import { tr } from '../../shared/lib/i18n.js'

type EmailSendRow = typeof emailSends.$inferSelect

// Volum sub 50/trimitere (decizie Stefan) — delay simplu între emailuri, fără coadă.
const DELAY_BETWEEN_SENDS_MS = 200

// Rezolvă cheia identității (ex: 'stefan', 'contact', 'outreach' sau orice identitate adăugată
// din Setări) la adresa "From" efectivă. Necunoscută = eroare tare (400 la apelant) — nu
// tăcem și trimitem de pe altă identitate decât a ales Stefan. Identitate configurată cu
// fromAddress gol = fail-soft pe contact (pattern-ul outreach din 2026-08-12).
async function resolveFromAddress(from: z.infer<typeof EmailFromSchema>): Promise<string> {
  const identities = await getIdentities()
  const identity = identities.find((i) => i.key === from)
  if (!identity) throw new Error(tr('errors.email.unknownIdentity', { from }))
  if (!identity.fromAddress) {
    return identities.find((i) => i.key === 'contact' && i.fromAddress)?.fromAddress ?? config.emailFromContact
  }
  return identity.fromAddress
}

/**
 * Corp complet (text + html) pt. un mesaj compus liber (Compose 1:1), cu semnătura ataşată.
 * `bodyHtml` e sursa (2026-08-11 — editor rich-text, ComposeDialog.tsx) — textul simplu se
 * DERIVĂ din HTML (htmlToPlainText, deja folosit la ingest-ul mesajelor primite), nu invers.
 */
async function composeWithSignature(bodyHtml: string, from: z.infer<typeof EmailFromSchema>): Promise<{ text: string; html: string }> {
  const sig = await buildSignature(from)
  return {
    text: `${htmlToPlainText(bodyHtml)}${sig.text}`,
    html: `${bodyHtml}${sig.html}`,
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

export async function listTemplates() {
  return db.select().from(emailTemplates).where(isNull(emailTemplates.deletedAt)).orderBy(desc(emailTemplates.createdAt))
}

export async function getTemplate(id: string) {
  const [row] = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
  return row ?? null
}

export async function createTemplate(input: z.infer<typeof TemplateCreateSchema>) {
  const [row] = await db.insert(emailTemplates).values(input).returning()
  return row
}

export async function updateTemplate(id: string, input: z.infer<typeof TemplateUpdateSchema>) {
  const [row] = await db
    .update(emailTemplates)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
    .returning()
  return row ?? null
}

export async function softDeleteTemplate(id: string): Promise<boolean> {
  const [row] = await db
    .update(emailTemplates)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
    .returning({ id: emailTemplates.id })
  return Boolean(row)
}

// ── Send (1:1) ───────────────────────────────────────────────────────────────

export async function sendSingle(me: SessionUser, input: z.infer<typeof SendCreateSchema>): Promise<EmailSendRow> {
  const { to, subject, body, templateId, from, attachments } = input
  // Trimiterea acceptă doar cutiile omului (C2) — compose nu e o excepție la regulă.
  assertCanSendFrom(me, from)
  // Validare explicită înainte de insert — fără ea, un templateId inexistent (UUID
  // valid ca formă, dar fără rând) trece de Zod și pică abia la FK constraint pe
  // insert, cu eroare SQL brută urcată necaptată (BUG-EMAIL-001, găsit de QA).
  if (templateId && !(await getTemplate(templateId))) {
    throw new Error(tr('errors.email.templateNotFound'))
  }
  const fromAddress = await resolveFromAddress(from)
  const { text, html } = await composeWithSignature(body, from)
  // Poze inserate din editor → atașament MIME cu cid: la trimiterea reală (nu URL extern, vezi
  // images-service.ts) — `html` stocat mai jos (bodyHtml) rămâne neatins, cu URL-ul public.
  const { html: sendHtml, attachments: inlineImageAttachments } = await inlineStoredImages(html)
  const result = await sendEmailWithResult({
    to,
    subject,
    text,
    html: sendHtml,
    from: fromAddress,
    attachments: [
      ...inlineImageAttachments,
      ...(attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'base64') })) ?? []),
    ],
  })
  const [row] = await db
    .insert(emailSends)
    .values({
      templateId: templateId ?? null,
      recipient: to,
      fromAddress,
      subject,
      bodyText: text,
      bodyHtml: html,
      status: result.ok ? 'sent' : 'failed',
      errorMessage: result.ok ? null : result.error,
      resendEmailId: result.id ?? null,
      batchId: null,
      sentByUserId: me.id,
    })
    .returning()
  if (!row) throw new Error(tr('errors.email.sendInsertFailed'))

  if (result.ok) {
    // Oglindire în thread/conversație — DOAR Compose 1:1, NU bulk (decizie fixată în PLAN.md).
    // Failure izolat: dacă oglindirea pică, trimiterea deja reușită tot rămâne validă.
    try {
      await mirrorOutboundMessage({
        fromAddress,
        toAddress: to,
        subject,
        body,
        sentByUserId: me.id,
        resendEmailId: result.id ?? null,
        attachments,
      })
    } catch (err) {
      console.error(`[email] oglindire Compose în thread eșuată pentru "${subject}" → ${to}: ${String(err)}`)
    }
  }

  return row
}

// ── Bulk send: clienți activi per platformă ──────────────────────────────────

export interface PlatformClientRecipient {
  email: string
  nume: string
}

// Populează destinatarii din BulkSendTab cu un click ("Trimite la clienții din <platformă>") —
// aceiași clienți activi ca `invoicing/listClients` (exclude demo/în ștergere/soft-deletați),
// filtrați suplimentar pe platformId și pe email completat (nu toți clienții au unul).
export async function listPlatformClientRecipients(platformId: string): Promise<PlatformClientRecipient[]> {
  const rows = await db
    .select({ email: billingClients.email, name: billingClients.name })
    .from(billingClients)
    .where(
      and(
        eq(billingClients.platformId, platformId),
        isNull(billingClients.deletedAt),
        eq(billingClients.isDemo, false),
        isNull(billingClients.pendingDeletionAt),
      ),
    )
    .orderBy(billingClients.name)

  return rows.filter((r): r is { email: string; name: string } => !!r.email).map((r) => ({ email: r.email, nume: r.name }))
}

function renderBody(template: string, nume?: string): string {
  // {{nume}} e singurul placeholder suportat acum — gol dacă lipsește `nume`.
  return template.replaceAll('{{nume}}', nume ?? '')
}

// 2026-08-11 — link direct în loc de "răspunde cu dezabonare" (text static, procesat manual).
// Fallback pe textul static dacă EMAIL_UNSUBSCRIBE_SECRET nu e configurat încă (buildUnsubscribeToken
// întoarce null) — niciodată un link rupt, dar tot trimitem emailul (nu blocăm bulk-send-ul).
function unsubscribeFooterText(recipientEmail: string): string {
  const token = buildUnsubscribeToken(recipientEmail)
  if (!token) return config.emailUnsubscribeText
  return `Pentru a nu mai primi acest tip de email, dă click aici: ${config.frontendOrigin}/api/email/unsubscribe/${token}`
}

function appendUnsubscribeFooter(body: string, recipientEmail: string): string {
  return `${body}\n\n---\n${unsubscribeFooterText(recipientEmail)}`
}

function unsubscribeFooterHtml(recipientEmail: string): string {
  const token = buildUnsubscribeToken(recipientEmail)
  if (!token) return `<p style="margin:0;color:#94a3b8;font-size:12px">${escapeHtml(config.emailUnsubscribeText)}</p>`
  const url = `${config.frontendOrigin}/api/email/unsubscribe/${token}`
  return `<a href="${escapeHtml(url)}" style="display:inline-block;border:1px solid #cbd5e1;color:#64748b;text-decoration:none;font-size:12px;padding:8px 18px;border-radius:999px">Dezabonează-te</a>`
}

/**
 * RFC 8058 — `List-Unsubscribe` + `List-Unsubscribe-Post` fac clientul de mail (Gmail etc.) să
 * arate un buton nativ "Unsubscribe" lângă expeditor (hover pe email), fără să deschidă niciun
 * link — un POST direct, silențios, pe ruta dedicată (`routes.ts`, aceeași ca link-ul din
 * footer). Fără token (secret neconfigurat), omitem headerele — mai bine fără chip nativ decât
 * un POST care oricum ar eșua (verifyUnsubscribeToken întoarce null fără secret).
 */
function unsubscribeHeaders(recipientEmail: string): Record<string, string> | undefined {
  const token = buildUnsubscribeToken(recipientEmail)
  if (!token) return undefined
  return {
    'List-Unsubscribe': `<${config.frontendOrigin}/api/email/unsubscribe/${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface SendCampaignEmailParams {
  to: string
  nume?: string
  templateId: string
  from: z.infer<typeof EmailFromSchema>
  batchId?: string | null
  sequenceEnrollmentId?: string | null
  attachments?: z.infer<typeof EmailAttachmentSchema>[]
}

/**
 * Corpul per-destinatar reutilizat de `bulkSend` ȘI de `jobs/email-sequence-runner.ts` (extras
 * 2026-08-12, vezi PLAN.md „Contract — send-ul reutilizat") — render + footer/headers de
 * dezabonare + inline de poze + trimitere efectivă + insert `email_sends`. NU face dedup/
 * suprimare/plafon — astea rămân la nivelul apelantului (semantica diferă: bulkSend dedupe pe
 * (recipient, templateId), sequence-runner pe status de enrollment).
 */
export async function sendCampaignEmail(params: SendCampaignEmailParams): Promise<{ result: SendEmailResult; row: EmailSendRow }> {
  const { to, nume, templateId, from, batchId = null, sequenceEnrollmentId = null, attachments } = params
  const template = await getTemplate(templateId)
  if (!template) throw new Error(tr('errors.email.templateNotFound'))

  const fromAddress = await resolveFromAddress(from)
  const sig = await buildSignature(from)
  // template.body e HTML (sursa — editor rich-text, TemplateFormDialog.tsx) — text simplu
  // derivat din el (htmlToPlainText), nu invers.
  const renderedBodyHtml = renderBody(template.body, nume)
  const text = appendUnsubscribeFooter(htmlToPlainText(renderedBodyHtml), to) + sig.text
  const html = wrapBulkCampaignHtml(`${renderedBodyHtml}${sig.html}`, unsubscribeFooterHtml(to), (await getCompany()).profile.name)
  const { html: sendHtml, attachments: inlineImageAttachments } = await inlineStoredImages(html)
  const result = await sendEmailWithResult({
    to,
    subject: renderBody(template.subject, nume),
    text,
    html: sendHtml,
    from: fromAddress,
    headers: unsubscribeHeaders(to),
    attachments: [
      ...inlineImageAttachments,
      ...(attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'base64') })) ?? []),
    ],
  })

  const [row] = await db
    .insert(emailSends)
    .values({
      templateId,
      recipient: to,
      fromAddress,
      subject: renderBody(template.subject, nume),
      bodyText: text,
      bodyHtml: html,
      status: result.ok ? 'sent' : 'failed',
      errorMessage: result.ok ? null : result.error,
      resendEmailId: result.id ?? null,
      batchId,
      sequenceEnrollmentId,
    })
    .returning()
  if (!row) throw new Error(tr('errors.email.sendInsertFailed'))

  return { result, row }
}

export interface BulkSendResult {
  sent: number
  skipped: number
  /** Sărite pt. că adresa e în email_suppressions (dezabonată) — separat de `skipped` (deja
   *  trimis anterior), ca Stefan să vadă direct câți s-au dezabonat, nu doar un total ambiguu. */
  suppressed: number
  failed: number
  results: EmailSendRow[]
  /** Adresele exacte sărite/dezabonate — dedup și suprimare NU creează niciun rând în
   *  `email_sends` (nimic de trimis), deci fără astea, contorul de mai sus e tot ce vede Stefan
   *  ("Sărit: 3" fără să știe CARE 3) — bug raportat live: nu vedea deloc cui a trimis și cui nu
   *  când tot batch-ul era dedup. Ephemeral ca și `results`-ul de eșec la insert secundar — nu
   *  persistă în DB, doar în răspunsul acestei chemări. */
  skippedRecipients: string[]
  suppressedRecipients: string[]
  /** 2026-08-12 — plafonul zilnic de warm-up (identitatea `outreach`) a fost atins în timpul
   *  acestui batch; restul destinatarilor NU au fost trimiși (nu parțial, fără să spună — vezi
   *  PLAN.md). Mereu gol pt. `from !== 'outreach'`. */
  capBlockedRecipients: string[]
}

export async function bulkSend(me: SessionUser, input: z.infer<typeof BulkSendSchema>): Promise<BulkSendResult> {
  const { templateId, recipients, from, attachments } = input
  assertCanSendFrom(me, from)
  const template = await getTemplate(templateId)
  if (!template) throw new Error(tr('errors.email.templateNotFound'))

  const batchId = randomUUID()
  // Un singur query pt. tot batch-ul (nu per destinatar, spre deosebire de dedup-ul de mai jos —
  // ăsta chiar e un IN() pe un set mic, nu o agregare, regula #9 nu se aplică).
  const suppressedEmails = await getSuppressedEmails(recipients.map((r) => r.email))
  // Plafon de warm-up — doar pt. identitatea outreach, verificat o singură dată înainte de buclă
  // (nu per destinatar) și decrementat local pe măsură ce trimitem.
  let outreachRemaining: number | null = from === 'outreach' ? (await getOutreachCapStatus()).remaining : null
  const results: EmailSendRow[] = []
  const skippedRecipients: string[] = []
  const suppressedRecipients: string[] = []
  const capBlockedRecipients: string[] = []
  let sent = 0
  let skipped = 0
  let suppressed = 0
  let failed = 0

  for (const recipient of recipients) {
    if (suppressedEmails.has(recipient.email.trim().toLowerCase())) {
      suppressed++
      suppressedRecipients.push(recipient.email)
      continue
    }

    if (outreachRemaining !== null && outreachRemaining <= 0) {
      capBlockedRecipients.push(recipient.email)
      continue
    }

    // Failure izolat per destinatar (regula #7 CLAUDE.md) — un rând picat (fie la
    // trimitere, fie la insert) nu oprește restul buclei.
    try {
      // Dedup: query separat mic per destinatar (volum <50 confirmat de Stefan) — mai
      // clar decât un singur IN() gigantic, regula #9 nu cere agregare aici, doar SQL
      // pentru agregări reale pe seturi mari. status != 'failed' — orice status care
      // înseamnă "Resend a acceptat trimiterea" (sent/delivered/bounced/etc.) contează
      // ca deja trimis; doar un eșec la submit permite reîncercarea.
      const [existing] = await db
        .select({ id: emailSends.id })
        .from(emailSends)
        .where(
          and(
            isNull(emailSends.deletedAt),
            eq(emailSends.recipient, recipient.email),
            eq(emailSends.templateId, templateId),
            ne(emailSends.status, 'failed'),
          ),
        )
        .limit(1)

      if (existing) {
        skipped++
        skippedRecipients.push(recipient.email)
        continue
      }

      const { result, row } = await sendCampaignEmail({ to: recipient.email, nume: recipient.nume, templateId, from, batchId, attachments })
      if (outreachRemaining !== null) outreachRemaining--

      results.push(row)
      if (result.ok) sent++
      else failed++
    } catch (err) {
      failed++
      console.error(`[email] bulk-send eșuat pentru ${recipient.email}: ${String(err)}`)
      try {
        const [row] = await db
          .insert(emailSends)
          .values({
            templateId,
            recipient: recipient.email,
            fromAddress: await resolveFromAddress(from),
            subject: renderBody(template.subject, recipient.nume),
            status: 'failed',
            errorMessage: String(err).slice(0, 500),
            batchId,
          })
          .returning()
        if (row) results.push(row)
      } catch (insertErr) {
        // Eșec secundar (DB jos etc.) — nu blocăm bucla, doar logăm.
        console.error(`[email] bulk-send: insert de eroare eșuat pentru ${recipient.email}: ${String(insertErr)}`)
      }
    }

    await delay(DELAY_BETWEEN_SENDS_MS)
  }

  return { sent, skipped, suppressed, failed, results, skippedRecipients, suppressedRecipients, capBlockedRecipients }
}

// ── Status livrare (webhook Resend) ─────────────────────────────────────────

export type DeliveryStatus = 'sent' | 'delivered' | 'bounced' | 'complained' | 'delayed' | 'failed'

/**
 * Update de status pt. un rând `email_sends`, pe baza unui eveniment webhook Resend
 * (email.delivered/bounced/complained/delivery_delayed). No-op silențios dacă `emailId`
 * nu se potrivește niciunui rând — nu e o eroare, doar alt tip de mesaj (webhook-uri
 * pt. inbound routing, nu pt. o trimitere a noastră).
 *
 * Bounce sau complaint suprimă adresa (`email_suppressions`), la fel ca un click de
 * dezabonare — altfel o secvență de follow-up continuă să trimită pe o adresă moartă
 * (runner-ul verifică doar suppressions, nu `email_sends.status`, vezi email-sequence-runner.ts).
 */
export async function updateSendStatusFromWebhook(
  emailId: string,
  status: DeliveryStatus,
  reason: string | null,
): Promise<void> {
  const [updated] = await db
    .update(emailSends)
    .set({ status, errorMessage: reason, updatedAt: new Date() })
    .where(eq(emailSends.resendEmailId, emailId))
    .returning({ recipient: emailSends.recipient })

  if (updated && (status === 'bounced' || status === 'complained')) {
    await suppressEmail(updated.recipient, status === 'bounced' ? 'bounce' : 'complaint')
  }
}

/**
 * Engagement (webhook Resend email.opened/email.clicked, 2026-08-11) — doar agregat
 * (open_count/click_count + timestamp la PRIMA apariție, COALESCE, nu suprascris la evenimente
 * repetate), nu un log per-eveniment. No-op silențios dacă `emailId` nu se potrivește niciunui
 * rând, la fel ca `updateSendStatusFromWebhook`. Idempotent la retry-uri Svix (count-ul poate
 * crește ușor peste realitate la retry, acceptabil pt. un rating agregat, no bloat).
 */
export async function recordEngagementEvent(emailId: string, type: 'opened' | 'clicked', clickedUrl: string | null): Promise<void> {
  if (type === 'opened') {
    await db
      .update(emailSends)
      .set({
        openedAt: sql`coalesce(${emailSends.openedAt}, now())`,
        openCount: sql`${emailSends.openCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(emailSends.resendEmailId, emailId))
    return
  }
  await db
    .update(emailSends)
    .set({
      clickedAt: sql`coalesce(${emailSends.clickedAt}, now())`,
      clickCount: sql`${emailSends.clickCount} + 1`,
      ...(clickedUrl ? { lastClickedUrl: clickedUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(emailSends.resendEmailId, emailId))
}

// ── Sends (istoric) ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Condițiile comune celor 3 view-uri pe istoricul de sends (listă/raport/export CSV) —
 * sursă + secvență + engagement + perioadă, exact filtrele din SentTab.tsx. Un singur loc care
 * le traduce în SQL, ca raportul și exportul să numere garantat aceleași rânduri ca tabelul.
 */
function buildSendFilterConditions(query: z.infer<typeof SendsFilterQuerySchema>): SQL[] {
  const conditions: SQL[] = [isNull(emailSends.deletedAt)]
  if (query.source === 'manual') conditions.push(isNull(emailSends.batchId), isNull(emailSends.sequenceEnrollmentId))
  if (query.source === 'bulk') conditions.push(sql`${emailSends.batchId} IS NOT NULL`)
  if (query.source === 'sequence') {
    conditions.push(sql`${emailSends.sequenceEnrollmentId} IS NOT NULL`)
    if (query.sequenceId) {
      conditions.push(
        inArray(
          emailSends.sequenceEnrollmentId,
          db.select({ id: emailSequenceEnrollments.id }).from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, query.sequenceId)),
        ),
      )
    }
  }
  if (query.engagement === 'engaged') {
    conditions.push(sql`(${emailSends.openCount} > 0 OR ${emailSends.clickCount} > 0)`)
  } else if (query.engagement === 'unengaged') {
    conditions.push(sql`(${emailSends.openCount} = 0 AND ${emailSends.clickCount} = 0)`)
  } else if (query.engagement === 'unsubscribed') {
    // Real unsubscribes only. Bounces are suppressed too (updateSendStatusFromWebhook) and can
    // be most of the list, so a recipient with a 'bounced' send is left out.
    // `email_sends.recipient` scris literal (NU ${emailSends.recipient}) în subquery-ul aliasat
    // `bs` — bug real găsit 2026-08-27: Drizzle emite coloana neambiguă ca "recipient" simplu
    // (FROM-ul exterior nu are alias), care în interiorul unui `FROM email_sends bs` se leagă
    // de RÂNDUL DIN `bs`, nu de rândul exterior (auto-corelare falsă: bs.recipient = bs.recipient,
    // mereu adevărat) — condiția NOT EXISTS devenea mereu falsă, deci "Dezabonări" arăta 0.
    conditions.push(sql`(
      EXISTS (SELECT 1 FROM ${emailSuppressions} WHERE lower(${emailSuppressions.email}) = lower(email_sends.recipient))
      AND NOT EXISTS (
        SELECT 1 FROM ${emailSends} bs
        WHERE lower(bs.recipient) = lower(email_sends.recipient) AND bs.status = 'bounced'
      )
    )`)
  }
  if (query.period || query.from || query.to) {
    const range = resolvePeriod(query.period, query.from, query.to)
    conditions.push(gte(emailSends.createdAt, range.from), lte(emailSends.createdAt, range.to))
  }
  return conditions
}

export async function listSends(query: z.infer<typeof SendsQuerySchema>) {
  const conditions = buildSendFilterConditions(query)
  if (query.templateId) conditions.push(eq(emailSends.templateId, query.templateId))
  if (query.recipient) conditions.push(eq(emailSends.recipient, query.recipient))
  if (query.batchId) conditions.push(eq(emailSends.batchId, query.batchId))
  if (query.batchIds) {
    const ids = query.batchIds.split(',').filter((id) => UUID_RE.test(id))
    if (ids.length > 0) conditions.push(inArray(emailSends.batchId, ids))
  }
  if (query.q) {
    const term = `%${query.q}%`
    const match = or(ilike(emailSends.recipient, term), ilike(emailSends.subject, term), ilike(emailSends.fromAddress, term))
    if (match) conditions.push(match)
  }

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(emailSends)
      .where(and(...conditions))
      .orderBy(desc(emailSends.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(emailSends)
      .where(and(...conditions)),
  ])
  const total = totalRows[0]?.total ?? 0

  // 2026-08-11 — Stefan nu vedea nicăieri cine s-a dezabonat (confirmat corect în DB, doar
  // invizibil în UI). Un singur query batched pt. toată pagina (regula #9 CLAUDE.md), nu per rând.
  const suppressed = await getSuppressedEmails(rows.map((r) => r.recipient))
  const items = rows.map((r) => ({ ...r, isSuppressed: suppressed.has(r.recipient.trim().toLowerCase()) }))
  return { items, total }
}

function withRates<T extends { sent: number; opened: number; clicked: number }>(row: T) {
  return {
    ...row,
    openRate: row.sent > 0 ? row.opened / row.sent : 0,
    clickRate: row.sent > 0 ? row.clicked / row.sent : 0,
  }
}

/**
 * Raport pe filtrele din SentTab.tsx (sursă, secvență, perioadă) — totaluri + defalcare pe
 * secvență/template, ca Stefan să vadă unde performează engagement-ul, nu doar câte au plecat.
 * Agregare în SQL (regula #9 CLAUDE.md), nu .reduce() peste rânduri aduse în JS.
 */
function withReplyRate<T extends { sent: number; replied: number }>(row: T) {
  return { ...row, replyRate: row.sent > 0 ? row.replied / row.sent : 0 }
}

// „Răspuns" = există un mesaj inbound real de la destinatar SAU de la același DOMENIU, primit
// DUPĂ send-ul respectiv — nu doar starea 'replied' a unei înscrieri în secvență (care rămâne
// NULL/absentă pt. sends manuale/bulk, deci un reply la un email obișnuit era invizibil aici —
// bug raportat de Stefan, 2026-08-27). Matching pe domeniu adăugat aceeași zi (exemplu real:
// outreach trimis la contact@firma.example, răspuns venit de la alt.nume@firma.example —
// altă persoană, aceeași companie) — decizie Stefan: mai sigur să numărăm larg (fals-pozitiv
// minor: cineva de la același domeniu scrie despre altceva) decât să ratăm răspunsuri reale,
// aceeași filozofie ca stopSequencesForReplyFrom (sequences-service.ts).
// COUNT DISTINCT pe destinatar (nu pe rând) — cineva care a primit 3 emailuri din aceeași
// secvență și a răspuns o dată numără o dată, nu de 3 ori.
const REPLIED_EXISTS = sql`EXISTS (
  SELECT 1 FROM email_messages em
  WHERE em.direction = 'in'
    AND (
      lower(trim(em.from_address)) = lower(trim(${emailSends.recipient}))
      OR split_part(lower(trim(em.from_address)), '@', 2) = split_part(lower(trim(${emailSends.recipient})), '@', 2)
    )
    AND COALESCE(em.received_at, em.created_at) > ${emailSends.createdAt}
)`

export async function getSendsReport(query: z.infer<typeof SendsFilterQuerySchema>) {
  const conditions = buildSendFilterConditions(query)

  const [totalsRow] = await db
    .select({
      sent: sql<number>`COUNT(*)::int`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} = 'delivered')::int`,
      bounced: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} = 'bounced')::int`,
      complained: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} = 'complained')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} = 'failed')::int`,
      opened: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.openCount} > 0)::int`,
      clicked: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.clickCount} > 0)::int`,
      // Dezabonări PURE (2026-08-26): bounce-urile sunt și ele în email_suppressions
      // (suppressEmail din webhook-ul de bounced) dar nu-s dezabonări reale — excludem
      // recipientii cu vreun send 'bounced'; aceia apar deja la cardul Bounce.
      // `email_sends.recipient` literal, NU ${emailSends.recipient} — vezi comentariul din
      // buildSendFilterConditions (același bug de auto-corelare, găsit 2026-08-27).
      unsubscribed: sql<number>`COUNT(DISTINCT ${emailSends.recipient}) FILTER (WHERE EXISTS (
        SELECT 1 FROM email_suppressions es WHERE es.email = LOWER(TRIM(email_sends.recipient))
      ) AND NOT EXISTS (
        SELECT 1 FROM email_sends bs WHERE LOWER(TRIM(bs.recipient)) = LOWER(TRIM(email_sends.recipient)) AND bs.status = 'bounced'
      ))::int`,
      replied: sql<number>`COUNT(DISTINCT lower(trim(${emailSends.recipient}))) FILTER (WHERE ${REPLIED_EXISTS})::int`,
    })
    .from(emailSends)
    .where(and(...conditions))

  const bySequence = await db
    .select({
      sequenceId: emailSequences.id,
      sequenceName: emailSequences.name,
      sent: sql<number>`COUNT(*)::int`,
      opened: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.openCount} > 0)::int`,
      clicked: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.clickCount} > 0)::int`,
      replied: sql<number>`COUNT(DISTINCT lower(trim(${emailSends.recipient}))) FILTER (WHERE ${REPLIED_EXISTS})::int`,
    })
    .from(emailSends)
    .innerJoin(emailSequenceEnrollments, eq(emailSends.sequenceEnrollmentId, emailSequenceEnrollments.id))
    .innerJoin(emailSequences, eq(emailSequenceEnrollments.sequenceId, emailSequences.id))
    .where(and(...conditions))
    .groupBy(emailSequences.id, emailSequences.name)
    .orderBy(desc(sql`count(*)`))

  const byTemplate = await db
    .select({
      templateId: emailTemplates.id,
      templateName: emailTemplates.name,
      sent: sql<number>`COUNT(*)::int`,
      opened: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.openCount} > 0)::int`,
      clicked: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.clickCount} > 0)::int`,
    })
    .from(emailSends)
    .innerJoin(emailTemplates, eq(emailSends.templateId, emailTemplates.id))
    .where(and(...conditions))
    .groupBy(emailTemplates.id, emailTemplates.name)
    .orderBy(desc(sql`count(*)`))

  return {
    totals: withReplyRate(
      withRates(totalsRow ?? { sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, opened: 0, clicked: 0, unsubscribed: 0, replied: 0 }),
    ),
    bySequence: bySequence.map((row) => withReplyRate(withRates(row))),
    byTemplate: byTemplate.map(withRates),
  }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function sendSourceLabel(row: { batchId: string | null; sequenceEnrollmentId: string | null }): string {
  if (row.batchId) return 'bulk'
  if (row.sequenceEnrollmentId) return 'secventa'
  return 'manual'
}

/**
 * Export CSV pe aceleași filtre ca raportul/tabelul — plafonat la 5000 rânduri (generos pt.
 * volumul unui singur outreach solo, vezi DELAY_BETWEEN_SENDS_MS mai sus; evită un export
 * nemărginit pe un `ytd` fără alt filtru).
 */
export async function exportSendsCsv(query: z.infer<typeof SendsFilterQuerySchema>): Promise<string> {
  const conditions = buildSendFilterConditions(query)
  const rows = await db.select().from(emailSends).where(and(...conditions)).orderBy(desc(emailSends.createdAt)).limit(5000)

  const header = ['data', 'sursa', 'de_la', 'catre', 'subiect', 'stare', 'deschideri', 'click-uri', 'dezabonat']
  if (rows.length === 0) return header.join(',')

  const suppressed = await getSuppressedEmails(rows.map((r) => r.recipient))
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      sendSourceLabel(r),
      r.fromAddress ?? '',
      r.recipient,
      r.subject,
      r.status,
      String(r.openCount),
      String(r.clickCount),
      suppressed.has(r.recipient.trim().toLowerCase()) ? 'da' : 'nu',
    ]
      .map(String)
      .map(csvEscape)
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}

/**
 * Cele mai recente N batch-uri bulk distincte (după cea mai recentă trimitere din fiecare) —
 * BulkSendTab.tsx seedează `batchIds` din URL cu astea la prima încărcare a paginii, ca istoricul
 * să fie vizibil din oficiu, nu doar printr-un URL construit manual (bug raportat live de Stefan).
 */
export async function getRecentBatchIds(limit: number): Promise<string[]> {
  const rows = await db
    .select({ batchId: emailSends.batchId, lastAt: sql<string>`max(${emailSends.createdAt})` })
    .from(emailSends)
    .where(and(isNull(emailSends.deletedAt), sql`${emailSends.batchId} IS NOT NULL`))
    .groupBy(emailSends.batchId)
    .orderBy(desc(sql`max(${emailSends.createdAt})`))
    .limit(limit)
  return rows.map((r) => r.batchId).filter((id): id is string => id !== null)
}

// ── Consum Resend (plan gratuit: 200/zi, 3000/lună) ─────────────────────────

/**
 * Numără trimiterile reale către Resend dintr-o fereastră de timp — SUM SQL, regula #9
 * CLAUDE.md. Două surse: `email_sends` (Compose 1:1 + bulk + reply/forward de thread, toate
 * oglindite acolo acum, `status != 'failed'` — 'failed' înseamnă Resend n-a acceptat niciodată
 * submit-ul, deci nu consumă cota) și `email_messages` (direction='out') doar pt. rânduri
 * istorice, trimise înainte ca reply/forward să înceapă să oglindească în `email_sends`
 * (2026-09-07) — excluse explicit dacă `resend_email_id`-ul e deja numărat acolo, ca să nu
 * se dubleze.
 */
async function countSendsSince(from: Date): Promise<number> {
  const [sends, replies] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(emailSends)
      .where(and(isNull(emailSends.deletedAt), ne(emailSends.status, 'failed'), gte(emailSends.createdAt, from))),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(emailMessages)
      .where(
        and(
          isNull(emailMessages.deletedAt),
          eq(emailMessages.direction, 'out'),
          gte(emailMessages.createdAt, from),
          sql`(${emailMessages.resendEmailId} IS NULL OR NOT EXISTS (
            SELECT 1 FROM ${emailSends} WHERE ${emailSends.resendEmailId} = ${emailMessages.resendEmailId}
          ))`,
        ),
      ),
  ])
  return (sends[0]?.count ?? 0) + (replies[0]?.count ?? 0)
}

export interface SendQuotaUsage {
  today: number
  month: number
  dailyLimit: number
  monthlyLimit: number
}

/**
 * Preferă totalul REAL de la Resend (cont întreg — vede și alertele dash trimise direct, și
 * emailurile automate din vanagreen, pe alt user SMTP dar ACELAȘI cont) — vezi
 * shared/lib/email.ts::getResendSentCount. Cade pe numărătoarea locală (doar `email_sends`/
 * `email_messages` din acest repo) dacă Resend nu răspunde, ca „Azi/Luna asta" să nu dispară
 * complet la un blip de rețea.
 */
export async function getSendQuotaUsage(): Promise<SendQuotaUsage> {
  const now = new Date()
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const [todayResend, monthResend] = await Promise.all([
    getResendSentCount(startOfDay, now),
    getResendSentCount(startOfMonth, now),
  ])
  const [today, month] =
    todayResend !== null && monthResend !== null
      ? [todayResend, monthResend]
      : await Promise.all([countSendsSince(startOfDay), countSendsSince(startOfMonth)])

  return { today, month, dailyLimit: config.resendDailyLimit, monthlyLimit: config.resendMonthlyLimit }
}

// ── Warm-up outreach (2026-08-12) ────────────────────────────────────────────
//
/** Trimiteri de azi pe identitatea outreach — reutilizează pattern-ul `countSendsSince` de mai
 *  sus (SUM SQL, regula #9), scoped pe `fromAddress` outreach în loc de tot `email_sends`. */
async function countOutreachSendsToday(): Promise<number> {
  const now = new Date()
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(emailSends)
    .where(and(isNull(emailSends.deletedAt), eq(emailSends.fromAddress, await resolveFromAddress('outreach')), gte(emailSends.createdAt, startOfDay)))
  return row?.count ?? 0
}

export interface OutreachCapStatus {
  cap: number
  usedToday: number
  remaining: number
}

/** Verificat înainte de fiecare send pe identitatea outreach (bulk SAU secvență) — dacă
 *  `remaining <= 0`, send-ul se amână/oprește (vezi bulkSend + jobs/email-sequence-runner.ts).
 *  Plafon manual, editabil din Setări Email — nu mai există rampă automată (decizie Stefan,
 *  2026-08-17): el urcă/coboară cap-ul singur pe măsură ce vede cum merge livrarea. */
export async function getOutreachCapStatus(): Promise<OutreachCapStatus> {
  const { outreachDailyCap: cap } = await getEmailSettings()
  const usedToday = await countOutreachSendsToday()
  return { cap, usedToday, remaining: Math.max(0, cap - usedToday) }
}
