import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { foldDiacritics, foldedIlike } from '../../shared/lib/text.js'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import {
  emailAttachments,
  emailMessages,
  emailThreadReads,
  emailThreads,
  syncLog,
  users,
} from '../../shared/db/schema/index.js'
import { computeSpamScore } from '../../shared/lib/email-spam-heuristic.js'
import { fetchReceivedEmail } from '../../shared/lib/email.js'
import { notifyPush } from '../../shared/lib/push.js'
import { saveDocument } from '../../shared/lib/storage.js'
import { htmlToPlainText } from './html-to-text.js'
import { evaluateRulesForMessage, isAddressBlocked, labelAllowsNotifications } from './organize-service.js'
import type { BulkUpdateSchema, MessagePatchSchema, ThreadsQuerySchema } from './inbound-schema.js'
import type { PreparedSend } from './scheduled-send.js'
import { stopSequencesForReplyFrom } from './sequences-service.js'
import { getEmailSettings, getIdentities } from './settings-service.js'
import {
  assertCanSendFromAddress,
  bareAddress,
  identityKeyForAddress,
  mailboxAddresses,
  markThreadRead,
  messageVisibleTo,
  soleMailboxHolder,
  threadVisibleTo,
  unreadThreadFilter,
  userIdsForIdentity,
} from './mailboxes.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { buildSignature, escapeHtml, textToHtmlParagraph } from './signature.js'
import { trFor, tr } from '../../shared/lib/i18n.js'
import { emitProspectEvent } from '../../shared/lib/prospect-events.js'
import { findProspectIdsByAddress } from '../../shared/lib/prospect-contact-status.js'
import { qualified } from '../../shared/lib/sql-fx.js'

// Ingest of mail received through Cloudflare Email Routing, plus the replies sent on an
// existing thread. Threads are matched on the normalized subject and a shared outside participant.
// (The older ingest through the Resend `email.received` webhook was dropped for cost;
// `fetchReceivedEmail` below is only used by replyToThread, for the Message-ID of old threads
// that came in through Resend.)

type EmailMessageRow = typeof emailMessages.$inferSelect
type EmailThreadRow = typeof emailThreads.$inferSelect

// ── Threading ────────────────────────────────────────────────────────────────

/** Strip `Re:`/`Fwd:`/`Fw:` (case-insensitive, oricâte repetări) și trim. */
export function normalizeSubject(subject: string): string {
  let s = subject.trim()
  const prefixRe = /^(re|fwd?):\s*/i
  while (prefixRe.test(s)) {
    s = s.replace(prefixRe, '').trim()
  }
  return s
}

// Exportate (nu doar `normalizeSubject`) pt. reuse din scripts/import-gmail-mbox-archive.ts —
// threading-ul unui import istoric trebuie să fie IDENTIC cu cel al fluxului live (altfel un
// reply viitor pe același subiect nu s-ar mai lega de threadul importat).
export async function findOrCreateThread(rawSubject: string, participants: string[]): Promise<EmailThreadRow> {
  const normalized = normalizeSubject(rawSubject)

  // Our own mailboxes are on every thread, so they can't be what links two messages: two
  // separate emails with the same subject to different people would land in one thread.
  // Match on the outside party; only a message between our own mailboxes falls back to them.
  const ownAddresses = new Set((await getIdentities()).map((identity) => bareAddress(identity.fromAddress)))
  const bare = Array.from(new Set(participants.map(bareAddress).filter((a) => a.length > 0)))
  const external = bare.filter((a) => !ownAddresses.has(a))
  const matchOn = external.length > 0 ? external : bare
  if (matchOn.length === 0) return createThread(normalized, participants)
  // The outside party alone is not enough either: one sender writing the same subject to two of
  // our mailboxes (a no-reply invite sent to each new colleague) is two conversations, and a
  // shared thread is visible to everyone holding either mailbox.
  const own = external.length > 0 ? bare.filter((a) => ownAddresses.has(a)) : []

  const [existing] = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        isNull(emailThreads.deletedAt),
        eq(emailThreads.subject, normalized),
        participantIn(matchOn),
        own.length > 0 ? participantIn(own) : undefined,
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(1)

  if (existing) return existing
  return createThread(normalized, participants)
}

const participantIn = (addresses: string[]) =>
  sql`EXISTS (SELECT 1 FROM unnest(${emailThreads.participants}) p
    WHERE lower(trim(coalesce(substring(p from '<([^<>]+)>'), p))) = ANY(ARRAY[${sql.join(addresses.map((a) => sql`${a}`), sql`, `)}]::text[]))`

async function createThread(normalized: string, participants: string[]): Promise<EmailThreadRow> {
  const [created] = await db
    .insert(emailThreads)
    .values({ subject: normalized, participants, lastMessageAt: new Date() })
    .returning()
  if (!created) throw new Error(tr('errors.email.threadInsertFailed'))
  return created
}

export async function touchThread(thread: EmailThreadRow, newParticipants: string[], lastMessageAt: Date): Promise<void> {
  const merged = Array.from(new Set([...thread.participants, ...newParticipants]))
  await db
    .update(emailThreads)
    .set({ participants: merged, lastMessageAt, updatedAt: new Date() })
    .where(eq(emailThreads.id, thread.id))
}

/** Sender-ul a mai trimis vreodată ceva înainte (pt. euristica de spam — sender nou = +2 puncte)? */
async function hasPriorMessagesFrom(fromAddress: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.direction, 'in'), sql`lower(${emailMessages.fromAddress}) = lower(${fromAddress})`))
    .limit(1)
  return Boolean(row)
}

/**
 * Ordinea fixată în PLAN.md: blocklist (match cert → trash, oprește tot) → regulile lui Stefan
 * (control explicit, prioritate mai mare — o regulă nu trebuie anulată de-o euristică) → DOAR
 * dacă nicio regulă n-a stabilit deja un folder ȘI detecția automată de spam e activă → scor.
 */
async function classifyInboundMessage(
  fromAddress: string,
  subject: string,
  bodyText: string | null,
  dmarc: string | null = null,
  toAddress: string | null = null,
): Promise<{ folder: 'inbox' | 'archive' | 'trash' | 'spam'; labelId: string | null }> {
  if (await isAddressBlocked(fromAddress)) {
    return { folder: 'trash', labelId: null }
  }
  // From: care pică DMARC nu e cine pretinde — nicio regulă nu-l scoate din spam, fiindcă regulile
  // se potrivesc tocmai pe adresa falsificată.
  if (dmarc === 'fail') {
    return { folder: 'spam', labelId: null }
  }

  const identityKey = toAddress ? identityKeyForAddress(toAddress, await getIdentities()) : null
  const mailboxOwnerId = identityKey ? await soleMailboxHolder(identityKey) : null
  const ruleResult = await evaluateRulesForMessage({ fromAddress, subject, mailboxOwnerId })
  if (ruleResult.folder) {
    return { folder: ruleResult.folder, labelId: ruleResult.labelId }
  }
  if (ruleResult.matched) {
    // O regulă a prins (chiar dacă a setat doar label, nu folder) — control explicit al lui
    // Stefan, oprim aici, NU mai trece prin euristica de spam (decizie fixată în PLAN.md).
    return { folder: 'inbox', labelId: ruleResult.labelId }
  }

  const settings = await getEmailSettings()
  if (settings.autoSpamEnabled) {
    const fromKnownBefore = await hasPriorMessagesFrom(fromAddress)
    const spam = computeSpamScore({ fromKnownBefore, subject, bodyText, keywords: settings.spamKeywords }, settings.spamThreshold)
    if (spam.isSpam) {
      return { folder: 'spam', labelId: ruleResult.labelId }
    }
  }

  return { folder: 'inbox', labelId: ruleResult.labelId }
}

// ── Cloudflare Email Routing ingest (Sprint D, Track 5) ─────────────────────
//
// Spre deosebire de Resend (webhook = notificare + fetch secundar la Received Emails
// API), Worker-ul Cloudflare trimite conținutul COMPLET într-un singur payload — nu
// există un "email_id" de urmărit ulterior. Reuse threading/clasificare/salvare
// atașamente din fluxul Resend de mai sus, DAR fără al doilea apel extern.

export interface CloudflareInboundPayload {
  from: string
  replyTo?: string | null
  to: string
  subject: string
  text: string | null
  html: string | null
  messageId: string | null
  dmarc?: string | null
  attachments: Array<{
    filename: string
    contentType: string | null
    contentBase64: string
    // Sprint 3 — leagă <img src="cid:X"> din bodyHtml de atașamentul inline corespunzător
    // (ținut manual sincron cu infra/cloudflare-email-worker/src/index.ts, risc pre-existent,
    // nu shared — vezi PLAN.md Risks).
    contentId?: string | null
    disposition?: 'attachment' | 'inline' | null
  }>
}

async function persistCloudflareAttachment(
  messageId: string,
  attachment: {
    filename: string
    contentType: string | null
    contentBase64: string
    contentId?: string | null
    disposition?: 'attachment' | 'inline' | null
  },
): Promise<void> {
  const safeFilename = attachment.filename.replace(/[^A-Za-z0-9._-]/g, '_')
  const buffer = Buffer.from(attachment.contentBase64, 'base64')
  const storagePath = await saveDocument(`email-attachments/${messageId}/${safeFilename}`, buffer)
  await db.insert(emailAttachments).values({
    messageId,
    filename: attachment.filename,
    storagePath,
    contentType: attachment.contentType,
    contentId: attachment.contentId ?? null,
    disposition: attachment.disposition ?? null,
  })
}

/**
 * Ingerează un mesaj primit prin Cloudflare Email Routing. Idempotent pe `sourceMessageId`
 * (Message-ID RFC, header disponibil direct — spre deosebire de Resend) — index unic parțial
 * WHERE inbound_source='cloudflare' (migrarea 0013). `messageId` poate lipsi (`null`) dacă
 * emailul primit nu are header Message-ID; în acel caz nu există cheie de dedup, inserăm direct
 * (Cloudflare Email Routing nu retrimite la eșec — regula #7 CLAUDE.md, handler-ul NU aruncă
 * mai departe din ruta webhook, vezi routes.ts).
 */
export async function ingestCloudflareInboundEmail(data: CloudflareInboundPayload): Promise<boolean> {
  if (data.messageId) {
    const [existing] = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(and(eq(emailMessages.sourceMessageId, data.messageId), eq(emailMessages.inboundSource, 'cloudflare')))
      .limit(1)
    if (existing) {
      console.warn(`[email] Cloudflare inbound retry pentru ${data.messageId} — mesaj deja procesat, ignor`)
      return false
    }
  }

  const participants = Array.from(new Set([data.from, data.to].filter((a) => a.length > 0)))
  const receivedAt = new Date()
  // `data.text` gol/absent (ex. ANAF SPV — trimite doar HTML) → convertim HTML-ul la text
  // simplu (nu-l stocăm brut, cu tag-uri vizibile — vezi html-to-text.ts).
  const bodyText = data.text || (data.html ? htmlToPlainText(data.html) : null)

  const { folder, labelId } = await classifyInboundMessage(data.from, data.subject, bodyText, data.dmarc ?? null, data.to)

  const thread = await findOrCreateThread(data.subject, participants)
  await touchThread(thread, participants, receivedAt)

  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: thread.id,
      direction: 'in',
      sourceMessageId: data.messageId,
      inboundSource: 'cloudflare',
      fromAddress: data.from,
      replyToAddress: data.replyTo || null,
      toAddress: data.to,
      subject: data.subject,
      bodyText,
      bodyHtml: data.html || null,
      receivedAt,
      folder,
      labelId,
    })
    .onConflictDoNothing({ target: emailMessages.sourceMessageId, where: eq(emailMessages.inboundSource, 'cloudflare') })
    .returning()

  if (!message) {
    // Race: o livrare concurentă a inserat deja între pre-check și insert.
    console.warn(`[email] insert duplicat evitat (onConflictDoNothing) pentru ${data.messageId}`)
    return false
  }

  for (const attachment of data.attachments) {
    try {
      await persistCloudflareAttachment(message.id, attachment)
    } catch (err) {
      // Failure izolat per atașament (regula #7 CLAUDE.md) — nu blocăm salvarea mesajului.
      console.error(`[email] atașament Cloudflare "${attachment.filename}" eșuat: ${String(err)}`)
    }
  }

  // Oprire la răspuns (2026-08-12, secvențe de follow-up automate, vezi PLAN.md) — orice mesaj
  // primit oprește TOATE secvențele active ale adresei expeditorului, nu doar cea "relevantă"
  // (euristica de threading e pe subiect+participanți, nu pe In-Reply-To real — mai sigur să
  // oprim larg decât să ratăm un răspuns). Failure izolat, ca marcarea unsubscribe.
  try {
    const stopped = await stopSequencesForReplyFrom(data.from)
    const enrollmentId = (stopped.find((e) => e.recipientEmail.trim().toLowerCase() === data.from.trim().toLowerCase()) ?? stopped[0])?.id
    const prospectIds = await findProspectIdsByAddress(data.from)
    for (const prospectId of prospectIds.length > 0 ? prospectIds : [null]) {
      emitProspectEvent('email.replied', { prospectId, address: data.from, ...(enrollmentId ? { enrollmentId } : {}) })
    }
  } catch (err) {
    console.error(`[email] oprire secvențe la răspuns eșuată pentru ${data.from}: ${String(err)}`)
  }

  if (await labelAllowsNotifications(labelId)) {
    // Push-ul îl primesc oamenii care au cutia pe care a venit emailul, nu toți abonații (C2) —
    // și doar cei care nu și-au oprit notificările de email nou.
    const identityKey = identityKeyForAddress(data.to, await getIdentities())
    const userIds = identityKey ? await userIdsForIdentity(identityKey) : []
    if (identityKey === null) console.warn(`[email] email primit pe adresa "${data.to}", care nu e identitate configurată — nimeni nu e anunțat`)
    if (userIds.length > 0) {
      void notifyPush(
        'email',
        (locale) => ({
          title: trFor(locale, 'push.email.newFrom', { from: data.from }),
          body: data.subject || trFor(locale, 'push.email.noSubject'),
          url: `/email?thread=${thread.id}`,
          // tag = thread.id — permite APK-ului să șteargă notificarea din bară când thread-ul se
          // deschide în aplicație (native-push.ts::dismissDeliveredNotificationsByTag), și dedup pe
          // Android dacă vin mai multe notificări pt. același thread (a doua o înlocuiește pe prima).
          tag: `thread-${thread.id}`,
        }),
        userIds,
      )
    }
  }

  return true
}

/**
 * Punct de intrare din ruta webhook Cloudflare. Loghează în `sync_log` (jobKey
 * `email:cloudflare-inbound`), la fel ca fluxul Resend — nu aruncă niciodată mai departe.
 */
export async function processCloudflareInboundWebhookEvent(data: CloudflareInboundPayload): Promise<void> {
  const [log] = await db.insert(syncLog).values({ jobKey: 'email:cloudflare-inbound', status: 'RUNNING' }).returning()

  try {
    const inserted = await ingestCloudflareInboundEmail(data)
    if (log) {
      await db
        .update(syncLog)
        .set({ status: 'SUCCESS', recordsSync: inserted ? 1 : 0, finishedAt: new Date() })
        .where(eq(syncLog.id, log.id))
    }
  } catch (err) {
    console.error(`[email] procesare webhook Cloudflare inbound eșuată: ${String(err)}`)
    if (log) {
      await db
        .update(syncLog)
        .set({ status: 'FAILED', errorMessage: String(err), finishedAt: new Date() })
        .where(eq(syncLog.id, log.id))
    }
  }
}

// ── Threads (API autentificat) ──────────────────────────────────────────────

/**
 * Filtrele comune listThreads/countThreads — un thread apare dacă ARE CEL PUȚIN UN mesaj care
 * se potrivește filtrului (folder/label/starred/search/atașament), nu dacă TOATE mesajele se
 * potrivesc. Extras separat ca `total`-ul de paginare să reflecte EXACT același set de
 * rezultate ca lista.
 */
function buildThreadConditions(
  me: SessionUser,
  query: Partial<z.infer<typeof ThreadsQuerySchema>> | undefined,
  mailboxScope: string[] | null,
): SQL[] {
  const conditions: SQL[] = [isNull(emailThreads.deletedAt)]
  // Cutii per om (C2): primul filtru, înainte de orice alt criteriu. Adminul (null) nu e
  // limitat; un om fără cutii nu vede niciun fir.
  const visible = threadVisibleTo(mailboxScope)
  if (visible) conditions.push(visible)

  if (query?.snoozed) {
    // Vedere dedicată "Amânate" — ignoră `folder` (un mesaj amânat poate fi din orice folder
    // de bază); decizie fixată în PLAN.md: fără cron, doar comparație de timp la citire.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id}
          AND m.snoozed_until IS NOT NULL AND m.snoozed_until > now() AND m.deleted_at IS NULL)`,
    )
  } else if (query?.folder && query.folder !== 'all') {
    const snoozeExclusion = query.folder === 'inbox' ? sql`AND (m.snoozed_until IS NULL OR m.snoozed_until <= now())` : sql``
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id} AND m.direction = 'in'
          AND m.folder = ${query.folder} AND m.deleted_at IS NULL ${snoozeExclusion})`,
    )
  } else if (query?.folder === 'all') {
    // All Mail — orice, cu excepția trash/spam (paritate Gmail).
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id}
          AND m.folder NOT IN ('trash','spam') AND m.deleted_at IS NULL)`,
    )
  }
  if (query?.labelId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id}
          AND m.label_id = ${query.labelId} AND m.deleted_at IS NULL)`,
    )
  }
  if (query?.isStarred) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id}
          AND m.is_starred = true AND m.deleted_at IS NULL)`,
    )
  }
  if (query?.toAddress) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id} AND m.direction = 'in'
          AND m.deleted_at IS NULL AND lower(m.to_address) = ${query.toAddress.toLowerCase()})`,
    )
  }
  if (query?.hasAttachment) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m JOIN email_attachments a ON a.message_id = m.id
          WHERE m.thread_id = ${emailThreads.id} AND m.deleted_at IS NULL AND a.deleted_at IS NULL)`,
    )
  }
  if (query?.from) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id} AND m.direction = 'in'
          AND m.deleted_at IS NULL AND ${foldedIlike(sql`m.from_address`, query.from)})`,
    )
  }
  if (query?.unread) conditions.push(unreadThreadFilter(me))
  // ISO strings cast in SQL: postgres.js cannot bind a Date inside a raw sql`` fragment.
  if (query?.after) conditions.push(sql`${emailThreads.lastMessageAt} >= ${query.after}::timestamptz`)
  if (query?.before) conditions.push(sql`${emailThreads.lastMessageAt} < ${query.before}::timestamptz`)
  if (query?.q) {
    // Fuzzy (2026-09-03, bug real Stefan: "dacă nu dau FIX adresa sau titlul nu-l găsește") —
    // `plainto_tsquery` singur cere match exact de cuvinte întregi și nu acoperea deloc
    // adresele participanților (`email_threads.participants`). Acum: tsvector pe subiect+corp
    // (rapid, index GIN existent) SAU similaritate trigram pe subiect (typo/parțial) SAU
    // adresa unui participant conține termenul (substring, insensibil la caz).
    conditions.push(
      sql`(
        EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = ${emailThreads.id} AND m.deleted_at IS NULL
            AND to_tsvector('simple', coalesce(m.subject,'') || ' ' || coalesce(m.body_text,''))
                @@ plainto_tsquery('simple', ${query.q}))
        OR similarity(${emailThreads.subject}, ${query.q}) > 0.2
        OR EXISTS (SELECT 1 FROM unnest(${emailThreads.participants}) p WHERE p ILIKE ${'%' + query.q + '%'})
      )`,
    )
  }

  return conditions
}

/** Total de thread-uri pt. filtrul curent — pt. paginare (Stefan navighează pagini vechi din
 *  arhivă). Un singur COUNT, regula #9 CLAUDE.md — nu numărăm array-ul deja tras în JS. */
export async function countThreads(
  me: SessionUser,
  query?: Partial<z.infer<typeof ThreadsQuerySchema>>,
): Promise<number> {
  const conditions = buildThreadConditions(me, query, await mailboxAddresses(me))
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailThreads)
    .where(and(...conditions))
  return row?.count ?? 0
}

/** Fără query params = comportamentul vechi (toate thread-urile, cele mai noi primele) —
 *  non-breaking pt. ce exista deja (PLAN.md, contract fixat). `offset` pt. paginare. */
export async function listThreads(
  me: SessionUser,
  query?: Partial<z.infer<typeof ThreadsQuerySchema>>,
): Promise<EmailThreadListItem[]> {
  const mailboxScope = await mailboxAddresses(me)
  const conditions = buildThreadConditions(me, query, mailboxScope)

  const orderBy =
    query?.sort === 'date_asc' ? asc(emailThreads.lastMessageAt)
    : query?.sort === 'subject_asc' ? asc(emailThreads.subject)
    : desc(emailThreads.lastMessageAt)

  const threads = await db
    .select()
    .from(emailThreads)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(query?.limit ?? 200)
    .offset(query?.offset ?? 0)

  if (threads.length === 0) return []

  // Mesajul reprezentativ per thread — preferă cel primit ('in') celui mai recent, apoi cel mai
  // recent creat, indiferent de direcție. Un singur query suplimentar mărginit de
  // `threads.length` (deja limitat de `query.limit`), nu o buclă N+1 — reducerea la "un mesaj
  // per thread" se face în JS pe un set deja mic/paginat, nu pe agregare la nivel de tabelă
  // întreagă (regula #9 vizează exact acel caz, nu post-procesarea unei pagini deja mărginite).
  const threadIds = threads.map((t) => t.id)
  const candidateMessages = await db
    .select({
      threadId: emailMessages.threadId,
      id: emailMessages.id,
      fromAddress: emailMessages.fromAddress,
      toAddress: emailMessages.toAddress,
      isRead: emailMessages.isRead,
      isStarred: emailMessages.isStarred,
      folder: emailMessages.folder,
      direction: emailMessages.direction,
      receivedAt: emailMessages.receivedAt,
      createdAt: emailMessages.createdAt,
    })
    .from(emailMessages)
    .where(and(inArray(emailMessages.threadId, threadIds), isNull(emailMessages.deletedAt)))
    .orderBy(desc(emailMessages.createdAt))

  // Citit/necitit per om (C2), nu per cutie: un fir e necitit dacă are un mesaj primit după
  // ultima lui citire. O singură întrebare pentru toată pagina.
  const reads = await db
    .select({ threadId: emailThreadReads.threadId, lastReadAt: emailThreadReads.lastReadAt })
    .from(emailThreadReads)
    .where(and(inArray(emailThreadReads.threadId, threadIds), eq(emailThreadReads.userId, me.id)))

  // Preferă mesajul primit ('in') cel mai recent per thread; dacă un thread n-are decât mesaje
  // proprii (ex: Compose oglindit, fără răspuns încă), cade pe cel mai recent 'out'.
  const summaryByThread = new Map<string, (typeof candidateMessages)[number]>()
  for (const m of candidateMessages) {
    if (m.direction === 'in' && !summaryByThread.has(m.threadId)) summaryByThread.set(m.threadId, m)
  }
  for (const m of candidateMessages) {
    if (!summaryByThread.has(m.threadId)) summaryByThread.set(m.threadId, m)
  }

  const messageIds = Array.from(summaryByThread.values()).map((m) => m.id)
  // Exclude disposition='inline' — poze embedate în HTML pt. randare (logo, iconițe semnătură,
  // vezi HtmlMessageBody.tsx care le afișează deja înăuntrul corpului via cid:), nu atașamente
  // reale de-al lui Stefan (bug real: apăreau dublu — o dată în corp, o dată în lista de jos).
  const attachmentsByMessage = messageIds.length
    ? await db
        .select({
          id: emailAttachments.id,
          messageId: emailAttachments.messageId,
          filename: emailAttachments.filename,
          contentType: emailAttachments.contentType,
        })
        .from(emailAttachments)
        .where(
          and(
            inArray(emailAttachments.messageId, messageIds),
            isNull(emailAttachments.deletedAt),
            // disposition poate fi NULL (sender fără header explicit) — trebuie inclus, doar
            // 'inline' exclus explicit; `<>` simplu ar exclude și NULL-urile (SQL: NULL <> x = NULL).
            sql`${emailAttachments.disposition} IS DISTINCT FROM 'inline'`,
          ),
        )
    : []
  const attachmentsByMessageId = new Map<string, ThreadAttachmentChip[]>()
  for (const a of attachmentsByMessage) {
    const list = attachmentsByMessageId.get(a.messageId) ?? []
    list.push({ id: a.id, filename: a.filename, contentType: a.contentType })
    attachmentsByMessageId.set(a.messageId, list)
  }

  // The row's snippet (E1): the latest message's text, whitespace collapsed. DISTINCT ON over the
  // page's threads reads idx_email_messages_thread_created; only the head of each body is scanned.
  const snippets = await db.execute<{ thread_id: string; snippet: string }>(sql`
    SELECT DISTINCT ON (m.thread_id) m.thread_id,
      left(btrim(regexp_replace(left(coalesce(m.body_text, ''), 600), ${WHITESPACE_RUN}, ' ', 'g')), 140) AS snippet
    FROM email_messages m
    WHERE m.thread_id IN (${sql.join(threadIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND m.deleted_at IS NULL
    ORDER BY m.thread_id, m.created_at DESC
  `)
  const snippetByThread = new Map(Array.from(snippets, (r) => [r.thread_id, r.snippet]))

  const lastReadByThread = new Map(reads.map((r) => [r.threadId, r.lastReadAt.getTime()]))
  const unreadByThread = new Set<string>()
  for (const m of candidateMessages) {
    if (m.direction !== 'in' || !m.receivedAt) continue
    const lastRead = lastReadByThread.get(m.threadId) ?? Number.NEGATIVE_INFINITY
    if (m.receivedAt.getTime() > lastRead) unreadByThread.add(m.threadId)
  }

  return threads.map((thread) => {
    const s = summaryByThread.get(thread.id)
    const attachments = s ? (attachmentsByMessageId.get(s.id) ?? []) : []
    const attachmentNames = attachments.map((a) => a.filename)
    return {
      ...thread,
      latestMessageId: s?.id ?? null,
      fromAddress: s?.fromAddress ?? null,
      toAddress: s?.toAddress ?? null,
      isRead: !unreadByThread.has(thread.id),
      isStarred: s?.isStarred ?? false,
      folder: s?.folder ?? null,
      hasAttachment: attachmentNames.length > 0,
      attachmentNames,
      attachments: attachments.slice(0, 3),
      snippet: snippetByThread.get(thread.id) ?? '',
    }
  })
}

// Passed as a parameter: a backslash inside the sql`` template would be eaten by JS.
const WHITESPACE_RUN = '\\s+'

export interface ThreadAttachmentChip {
  id: string
  filename: string
  contentType: string | null
}

export interface EmailThreadListItem extends EmailThreadRow {
  latestMessageId: string | null
  fromAddress: string | null
  toAddress: string | null
  isRead: boolean
  isStarred: boolean
  folder: 'inbox' | 'archive' | 'trash' | 'spam' | null
  hasAttachment: boolean
  /** Kept for older clients; `attachments` carries the ids for opening them. */
  attachmentNames: string[]
  attachments: ThreadAttachmentChip[]
  snippet: string
}

/**
 * Suggestions while typing in the search (E22): addresses from the same source as Compose's
 * autocomplete, and threads the person can see, matched without diacritics.
 */
export async function suggestSearch(
  me: SessionUser,
  q: string,
): Promise<{ addresses: string[]; threads: Array<{ id: string; subject: string; fromAddress: string | null; lastMessageAt: Date }> }> {
  const folded = foldDiacritics(q.toLowerCase())
  const addresses = (await getRecentAddresses(me, 200)).filter((a) => foldDiacritics(a.toLowerCase()).includes(folded)).slice(0, 5)

  const threads = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      lastMessageAt: emailThreads.lastMessageAt,
      fromAddress: sql<string | null>`(SELECT m.from_address FROM email_messages m
        WHERE m.thread_id = ${qualified(emailThreads.id)} AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1)`,
    })
    .from(emailThreads)
    .where(
      and(
        isNull(emailThreads.deletedAt),
        threadVisibleTo(await mailboxAddresses(me)),
        or(
          foldedIlike(emailThreads.subject, q),
          sql`EXISTS (SELECT 1 FROM unnest(${emailThreads.participants}) p WHERE ${foldedIlike(sql`p`, q)})`,
        ),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(5)
  return { addresses, threads }
}

/**
 * Adrese recente cu care Stefan a corespondat (trimise SAU primite), cele mai noi primele —
 * pt. autocomplete la Compose (Stefan: "mă streseaza să dau mereu copy-paste"). Două GROUP BY-uri
 * (regula #9 CLAUDE.md — agregarea rămâne în SQL), unite și dedupe-uite case-insensitive în JS,
 * dar pe seturi deja mici (adrese distincte, nu mesaje) — nu pe array-uri mari din DB.
 */
export async function getRecentAddresses(me: SessionUser, limit = 20): Promise<string[]> {
  const visible = messageVisibleTo(await mailboxAddresses(me))
  const sent = await db
    .select({ addr: emailMessages.toAddress, lastUsed: sql<Date>`max(${emailMessages.createdAt})` })
    .from(emailMessages)
    .where(and(eq(emailMessages.direction, 'out'), isNull(emailMessages.deletedAt), visible))
    .groupBy(emailMessages.toAddress)

  const received = await db
    .select({ addr: emailMessages.fromAddress, lastUsed: sql<Date>`max(${emailMessages.createdAt})` })
    .from(emailMessages)
    .where(and(eq(emailMessages.direction, 'in'), isNull(emailMessages.deletedAt), visible))
    .groupBy(emailMessages.fromAddress)

  // 2026-08-11 (bug Stefan — dropdown-ul de "Către" gol la Compose, endpoint-ul arunca la
  // fiecare request cu date reale): `sql<Date>` e doar un cast de TIPURI la compilare — driverul
  // postgres.js întoarce rezultatul unui `max(...)` brut ca STRING, nu ca instanță Date reală,
  // chiar dacă TypeScript "crede" contrariul. `row.lastUsed.getTime()` mai jos arunca deci mereu
  // (TypeError) în producție, de îndată ce exista măcar o adresă de procesat — request-ul pica
  // silențios (useQuery fără eroare vizibilă în UI), dropdown-ul rămânea gol la nesfârșit.
  const merged = new Map<string, { addr: string; lastUsed: Date }>()
  for (const row of [...sent, ...received]) {
    if (!row.addr) continue
    const key = row.addr.toLowerCase()
    const lastUsed = new Date(row.lastUsed)
    const existing = merged.get(key)
    if (!existing || lastUsed > existing.lastUsed) merged.set(key, { addr: row.addr, lastUsed })
  }

  return Array.from(merged.values())
    .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
    .slice(0, limit)
    .map((r) => r.addr)
}

/**
 * Badge-uri necitite (nav stânga + sidebar email) — un singur GROUP BY, regula #9 CLAUDE.md.
 * NeCITITELE sunt ale omului: mesaje primite pe cutiile lui, după ultima lui citire. Un coleg
 * care citește un fir nu îl scade din badge-ul celuilalt.
 */
export async function getUnreadCounts(me: SessionUser): Promise<{ inbox: number; spam: number; total: number }> {
  const mailboxScope = await mailboxAddresses(me)
  const visible = messageVisibleTo(mailboxScope)
  const rows = await db
    .select({ folder: emailMessages.folder, count: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.direction, 'in'),
        isNull(emailMessages.deletedAt),
        visible,
        sql`${emailMessages.receivedAt} > COALESCE(
              (SELECT r.last_read_at FROM email_thread_reads r
                WHERE r.thread_id = ${emailMessages.threadId} AND r.user_id = ${me.id} AND r.deleted_at IS NULL),
              '-infinity'::timestamptz)`,
      ),
    )
    .groupBy(emailMessages.folder)

  const inbox = rows.find((r) => r.folder === 'inbox')?.count ?? 0
  const spam = rows.find((r) => r.folder === 'spam')?.count ?? 0
  return { inbox, spam, total: inbox + spam }
}

type EmailAttachmentRow = typeof emailAttachments.$inferSelect

export async function getThreadWithMessages(
  me: SessionUser,
  id: string,
): Promise<{ thread: EmailThreadRow; messages: (EmailMessageRow & { attachments: EmailAttachmentRow[] })[] } | null> {
  const mailboxScope = await mailboxAddresses(me)
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, id), isNull(emailThreads.deletedAt), threadVisibleTo(mailboxScope)))
  // Fir pe o cutie străină → 404, ca unul inexistent: nu confirmăm că există.
  if (!thread) return null

  // A thread that also holds messages on someone else's mailbox shows only this person's
  // (same rule as attachments): threads merged before the threading fix exist on prod.
  const messages = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, id), isNull(emailMessages.deletedAt), messageVisibleTo(mailboxScope)))
    .orderBy(desc(emailMessages.createdAt))

  // Deschiderea firului marchează citit pentru omul ăsta și numai pentru el.
  await markThreadRead(me, id)

  const attachments = messages.length
    ? await db
        .select()
        .from(emailAttachments)
        .where(
          and(
            inArray(
              emailAttachments.messageId,
              messages.map((m) => m.id),
            ),
            isNull(emailAttachments.deletedAt),
          ),
        )
    : []

  const messagesWithAttachments = messages.map((m) => ({
    ...m,
    attachments: attachments.filter((a) => a.messageId === m.id),
  }))

  return { thread, messages: messagesWithAttachments }
}

// ── Acțiuni de mailbox (patch/bulk/forward/attachment) — Wave 1 BE ──────────

export async function patchMessage(
  me: SessionUser,
  id: string,
  patch: z.infer<typeof MessagePatchSchema>,
): Promise<EmailMessageRow | null> {
  const changes: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.isRead !== undefined) {
    // Citit/necitit e per om: `is_read` rămâne scris pentru compatibilitate cu porțiunile vechi
    // ale aplicației, dar starea reală stă în email_thread_reads (C2).
    changes.isRead = patch.isRead
    const [message] = await db
      .select({ threadId: emailMessages.threadId, receivedAt: emailMessages.receivedAt })
      .from(emailMessages)
      .where(eq(emailMessages.id, id))
    if (message) {
      await markThreadRead(
        me,
        message.threadId,
        patch.isRead ? (message.receivedAt ?? new Date()) : new Date(Date.now() - 1),
      )
    }
  }
  if (patch.isStarred !== undefined) changes.isStarred = patch.isStarred
  if (patch.folder !== undefined) changes.folder = patch.folder
  if (patch.snoozedUntil !== undefined) changes.snoozedUntil = patch.snoozedUntil ? new Date(patch.snoozedUntil) : null
  if (patch.labelId !== undefined) changes.labelId = patch.labelId

  const [row] = await db
    .update(emailMessages)
    .set(changes)
    .where(and(eq(emailMessages.id, id), isNull(emailMessages.deletedAt), messageVisibleTo(await mailboxAddresses(me))))
    .returning()
  return row ?? null
}

/** Multi-select — UN singur UPDATE (WHERE id = ANY(...)), nu buclă JS (regula #9 CLAUDE.md). */
/**
 * Of the given threads, the ones this person has read since their last incoming message. The app
 * asks this when it opens, to clear the notifications of emails read meanwhile on another device.
 */
export async function readThreadIds(me: SessionUser, threadIds: string[]): Promise<string[]> {
  if (threadIds.length === 0) return []
  const rows = await db
    .select({ threadId: emailThreadReads.threadId })
    .from(emailThreadReads)
    .innerJoin(emailThreads, eq(emailThreads.id, emailThreadReads.threadId))
    .where(
      and(
        inArray(emailThreadReads.threadId, threadIds),
        eq(emailThreadReads.userId, me.id),
        isNull(emailThreadReads.deletedAt),
        sql`${emailThreadReads.lastReadAt} >= ${emailThreads.lastMessageAt}`,
      ),
    )
  return rows.map((row) => row.threadId)
}

export async function bulkUpdateMessages(
  me: SessionUser,
  ids: string[],
  patch: z.infer<typeof BulkUpdateSchema>['patch'],
): Promise<number> {
  const changes: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.isRead !== undefined) changes.isRead = patch.isRead
  if (patch.folder !== undefined) changes.folder = patch.folder
  if (patch.snoozedUntil !== undefined) changes.snoozedUntil = patch.snoozedUntil ? new Date(patch.snoozedUntil) : null
  if (patch.labelId !== undefined) changes.labelId = patch.labelId

  const rows = await db
    .update(emailMessages)
    .set(changes)
    .where(and(inArray(emailMessages.id, ids), isNull(emailMessages.deletedAt), messageVisibleTo(await mailboxAddresses(me))))
    .returning({ id: emailMessages.id, threadId: emailMessages.threadId })
  // Citirea în masă e tot per om: pentru fiecare fir atins, starea lui de citit.
  if (patch.isRead !== undefined) {
    for (const threadId of new Set(rows.map((r) => r.threadId))) {
      await markThreadRead(me, threadId, patch.isRead ? new Date() : new Date(Date.now() - 1))
    }
  }
  return rows.length
}

export async function getMessageAttachment(me: SessionUser, id: string): Promise<EmailAttachmentRow | null> {
  const visible = messageVisibleTo(await mailboxAddresses(me))
  const [row] = await db
    .select({
      id: emailAttachments.id,
      createdAt: emailAttachments.createdAt,
      updatedAt: emailAttachments.updatedAt,
      deletedAt: emailAttachments.deletedAt,
      tenantId: emailAttachments.tenantId,
      messageId: emailAttachments.messageId,
      storagePath: emailAttachments.storagePath,
      filename: emailAttachments.filename,
      contentType: emailAttachments.contentType,
      contentId: emailAttachments.contentId,
      disposition: emailAttachments.disposition,
    })
    .from(emailAttachments)
    .innerJoin(emailMessages, eq(emailMessages.id, emailAttachments.messageId))
    .where(and(eq(emailAttachments.id, id), isNull(emailAttachments.deletedAt), visible))
  return row ?? null
}

/**
 * Forward: starts a NEW conversation with another recipient, not the original thread. The
 * original body is quoted; its attachments are re-attached from local storage (already downloaded
 * on receipt) when `includeOriginalAttachments` is set.
 */
export async function prepareForward(
  me: SessionUser,
  messageId: string,
  input: {
    to: string[]
    cc: string[]
    extraBody?: string
    includeOriginalAttachments: boolean
    attachments?: Array<{ filename: string; content: string }>
  },
): Promise<PreparedSend> {
  const [original] = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.id, messageId), isNull(emailMessages.deletedAt), messageVisibleTo(await mailboxAddresses(me))))
  if (!original) throw new Error(tr('errors.email.messageNotFound'))

  // The forward leaves from the original's mailbox, but the check is on the person, not the
  // message's address (otherwise a direct id would bypass it).
  const identities = await getIdentities()
  assertCanSendFromAddress(me, original.toAddress, identities)
  const fromKey = identityKeyForAddress(original.toAddress, identities) ?? 'contact'

  const subject = /^fwd:/i.test(original.subject) ? original.subject : `Fwd: ${original.subject}`
  // `extraBody` is HTML (rich-text editor); plain text and HTML are built separately.
  const extraBodyHtml = input.extraBody ?? ''
  const separatorText = tr('errors.email.forwardedHeader', { fromAddress: original.fromAddress, subject: original.subject })
  const quotedText = `${htmlToPlainText(extraBodyHtml)}${separatorText}${original.bodyText ?? ''}`
  const separatorHtml = `<p style="margin:16px 0 8px;color:#777;font-size:13px">${tr('errors.email.forwardedTitle')}<br>${tr('errors.email.forwardedFrom', { from: escapeHtml(original.fromAddress) })}<br>${tr('errors.email.forwardedSubject', { subject: escapeHtml(original.subject) })}</p>`
  const quotedHtml = `${extraBodyHtml}${separatorHtml}${original.bodyHtml ?? textToHtmlParagraph(original.bodyText ?? '')}`

  // The original's files are already on disk; the dispatcher reads them at send time.
  const storedAttachments = input.includeOriginalAttachments
    ? (
        await db
          .select({ filename: emailAttachments.filename, storagePath: emailAttachments.storagePath })
          .from(emailAttachments)
          .where(and(eq(emailAttachments.messageId, messageId), isNull(emailAttachments.deletedAt)))
      )
    : []

  // The signature is the sending mailbox's (or the person's own, if they set one).
  const sig = await buildSignature(fromKey, me.id)
  return {
    mode: 'forward',
    fromKey,
    fromAddress: original.toAddress,
    to: input.to,
    cc: input.cc,
    subject,
    text: `${quotedText}${sig.text}`,
    html: `${quotedHtml}${sig.html}`,
    body: extraBodyHtml,
    newAttachments: input.attachments ?? [],
    storedAttachments,
    threadId: original.threadId,
    sourceMessageId: original.id,
    message: { bodyText: quotedText, bodyHtml: quotedHtml },
  }
}

/** After a forward left: a new thread with the forwarded message in it. */
export async function recordForwardSent(input: {
  fromAddress: string
  to: string[]
  cc: string[]
  subject: string
  bodyText: string
  bodyHtml: string
  forwardOfMessageId: string | null
  resendEmailId: string | null
  sentByUserId: string | null
  attachments: Array<{ filename: string; content: string }>
}): Promise<void> {
  const participants = Array.from(new Set([input.fromAddress, ...input.to, ...input.cc]))
  const thread = await findOrCreateThread(input.subject, participants)
  await touchThread(thread, participants, new Date())

  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: thread.id,
      direction: 'out',
      resendEmailId: input.resendEmailId,
      fromAddress: input.fromAddress,
      toAddress: input.to.join(', '),
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      receivedAt: null,
      isRead: true,
      sentByUserId: input.sentByUserId,
      forwardOfMessageId: input.forwardOfMessageId,
    })
    .returning()
  if (!message) throw new Error(tr('errors.email.messageInsertFailedForward'))
  if (input.attachments.length) await persistOutboundAttachments(message.id, input.attachments)
}

/**
 * Reply on an existing thread. Sent from the inbound address the last received message came
 * to, with RFC In-Reply-To/References taken from that message's `message_id`.
 * Without explicit recipients it answers the last sender; `replyAll` adds the thread's other
 * outside participants as Cc.
 */
export async function prepareReply(
  me: SessionUser,
  threadId: string,
  input: {
    body: string
    to?: string[]
    cc?: string[]
    replyAll?: boolean
    attachments?: Array<{ filename: string; content: string }>
    lastSeenMessageId?: string | null
  },
): Promise<PreparedSend> {
  const ownAddresses = await mailboxAddresses(me)
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), isNull(emailThreads.deletedAt), threadVisibleTo(ownAddresses)))
  if (!thread) throw new Error(tr('errors.email.threadNotFound'))

  const [lastInbound] = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, threadId), eq(emailMessages.direction, 'in'), isNull(emailMessages.deletedAt)))
    .orderBy(desc(emailMessages.receivedAt))
    .limit(1)
  if (!lastInbound) throw new Error(tr('errors.email.threadNoInbound'))

  // The reply leaves from the last received message's address, not from an identity picked in the dialog.
  const identities = await getIdentities()
  assertCanSendFromAddress(me, lastInbound.toAddress, identities)
  const fromKey = identityKeyForAddress(lastInbound.toAddress, identities) ?? 'contact'

  // Double reply: the client sends the last message it saw; if another reply left meanwhile, the
  // person sees "Ion replied 3 min ago" and decides.
  if (input.lastSeenMessageId) {
    const [newer] = await db
      .select({ id: emailMessages.id, sentByUserId: emailMessages.sentByUserId, createdAt: emailMessages.createdAt })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.threadId, threadId),
          eq(emailMessages.direction, 'out'),
          isNull(emailMessages.deletedAt),
          sql`${emailMessages.createdAt} > (SELECT created_at FROM email_messages WHERE id = ${input.lastSeenMessageId})`,
        ),
      )
      .orderBy(desc(emailMessages.createdAt))
      .limit(1)
    if (newer) {
      const author = newer.sentByUserId
        ? (await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, newer.sentByUserId)))[0]
        : null
      const err = new Error('thread_replied_meanwhile') as Error & { code: string; by: string | null; at: Date }
      err.code = 'THREAD_REPLIED_MEANWHILE'
      err.by = author?.displayName ?? null
      err.at = newer.createdAt
      throw err
    }
  }

  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`

  // RFC Message-ID for In-Reply-To/References: the Cloudflare path has it on the row; only old
  // threads that came through Resend inbound (dropped) need a fetch.
  let headers: Record<string, string> | undefined
  if (lastInbound.sourceMessageId) {
    headers = { 'In-Reply-To': lastInbound.sourceMessageId, References: lastInbound.sourceMessageId }
  } else if (lastInbound.resendEmailId) {
    const received = await fetchReceivedEmail(lastInbound.resendEmailId)
    if (received?.messageId) {
      headers = { 'In-Reply-To': received.messageId, References: received.messageId }
    }
  }

  // Prefer Reply-To when the sender set it: From can be a technical/bounce address.
  const replyDestination = bareAddress(lastInbound.replyToAddress || lastInbound.fromAddress)
  const to = input.to?.length ? input.to : [replyDestination]
  let cc = input.cc ?? []
  if (input.replyAll && !input.cc) {
    // The thread's outside participants; ours (every configured mailbox) never go in Cc.
    const ours = new Set(identities.map((i) => i.fromAddress?.toLowerCase()).filter(Boolean))
    ours.add(lastInbound.toAddress.toLowerCase())
    const taken = new Set(to.map((a) => a.toLowerCase()))
    cc = thread.participants.map(bareAddress).filter((a) => a && !ours.has(a.toLowerCase()) && !taken.has(a.toLowerCase()))
    cc = Array.from(new Set(cc)).slice(0, 10)
  }

  // The signature is the sending mailbox's (or the person's own, if they set one).
  const sig = await buildSignature(fromKey, me.id)
  // `body` is HTML (rich-text editor); the plain text is derived from it.
  const bodyText = htmlToPlainText(input.body)
  return {
    mode: input.replyAll ? 'reply_all' : 'reply',
    fromKey,
    fromAddress: lastInbound.toAddress,
    to,
    cc,
    subject,
    text: `${bodyText}${sig.text}`,
    // Without `html` the signature logo never reaches the recipient.
    html: `${input.body}${sig.html}`,
    body: input.body,
    headers,
    newAttachments: input.attachments ?? [],
    storedAttachments: [],
    threadId,
    sourceMessageId: lastInbound.id,
    message: { bodyText, bodyHtml: input.body },
  }
}

/** After a reply left: the message on the thread, its files, the thread's date. */
export async function recordReplySent(input: {
  threadId: string
  fromAddress: string
  to: string[]
  subject: string
  bodyText: string
  bodyHtml: string
  resendEmailId: string | null
  sentByUserId: string | null
  attachments: Array<{ filename: string; content: string }>
}): Promise<void> {
  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: input.threadId,
      direction: 'out',
      resendEmailId: input.resendEmailId,
      fromAddress: input.fromAddress,
      toAddress: input.to.join(', '),
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      receivedAt: null,
      isRead: true, // mesaje proprii sunt implicit "citite"
      sentByUserId: input.sentByUserId,
    })
    .returning()
  if (!message) throw new Error(tr('errors.email.messageInsertFailed'))
  if (input.attachments.length) await persistOutboundAttachments(message.id, input.attachments)
  await db.update(emailThreads).set({ lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(emailThreads.id, input.threadId))
}

/** Saves sent attachments (Compose/Reply/Forward) locally, like received ones; otherwise they
 *  went straight to Resend and could not be viewed again. */
async function persistOutboundAttachments(messageId: string, attachments: Array<{ filename: string; content: string }>): Promise<void> {
  for (const [i, att] of attachments.entries()) {
    try {
      const safeName = att.filename.replace(/[^A-Za-z0-9._-]/g, '_')
      const storagePath = await saveDocument(`email-attachments/${messageId}/${i}_${safeName}`, Buffer.from(att.content, 'base64'))
      await db.insert(emailAttachments).values({ messageId, filename: att.filename, storagePath, contentType: null })
    } catch (err) {
      // Failure isolated per attachment (CLAUDE.md rule #7): do not block a send that already succeeded.
      console.error(`[email] salvare locală atașament trimis "${att.filename}" eșuată: ${String(err)}`)
    }
  }
}

/**
 * Mirrors a 1:1 Compose send (NOT bulk) into `email_threads`/`email_messages`, so it shows in
 * the conversation if someone replies, as in Gmail. New or existing thread, same threading
 * heuristic as inbound.
 */
export async function mirrorOutboundMessage(input: {
  fromAddress: string
  toAddress: string
  subject: string
  /** Who sent it (C2): the same mailbox can belong to two people. */
  sentByUserId?: string | null
  /** HTML (rich-text editor); `bodyText` is derived from it below. */
  body: string
  resendEmailId: string | null
  attachments?: Array<{ filename: string; content: string }>
  /** Every address on the message (to + cc); defaults to `toAddress`. */
  participants?: string[]
}): Promise<void> {
  const participants = Array.from(new Set([input.fromAddress, ...(input.participants ?? [input.toAddress])].filter((a) => a.length > 0)))
  const now = new Date()
  const thread = await findOrCreateThread(input.subject, participants)
  await touchThread(thread, participants, now)

  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: thread.id,
      direction: 'out',
      resendEmailId: input.resendEmailId,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      subject: input.subject,
      bodyText: htmlToPlainText(input.body),
      bodyHtml: input.body,
      receivedAt: null,
      isRead: true,
      sentByUserId: input.sentByUserId ?? null,
    })
    .returning()
  if (!message) throw new Error(tr('errors.email.messageInsertFailedCompose'))

  if (input.attachments?.length) await persistOutboundAttachments(message.id, input.attachments)
}
