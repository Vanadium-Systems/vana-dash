import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { emailDrafts, emailMessages, emailSends } from '../../shared/db/schema/index.js'
import { sendEmailWithResult } from '../../shared/lib/email.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import { currentTenantId, runAsTenant, withRlsBypass } from '../../shared/lib/tenancy.js'
import { tr } from '../../shared/lib/i18n.js'
import { inlineStoredImages } from './images-service.js'
import { mirrorOutboundMessage, prepareForward, prepareReply, recordForwardSent, recordReplySent } from './inbound-service.js'
import { assertCanDeliver, OUTREACH_IDENTITY } from './send-guard.js'
import { prepareSingle } from './service.js'

// Every send from a person waits UNDO_WINDOW_MS in email_sends ('scheduled') before it goes to
// Resend, so "Undo" can stop it. Validation and the delivery gate run when the person presses
// Send; the dispatcher runs the gate again, since the cap may have filled in between.
//
// Two things can dispatch a row: the in-process timer armed at schedule time, and the job
// (jobs/email-scheduled-sends.ts) for rows whose timer died with a restart. The claim is one
// conditional UPDATE (scheduled → sending), so only one of them gets the row; Resend receives
// the row id as Idempotency-Key, so re-dispatching a row stuck in 'sending' cannot send twice.

export const UNDO_WINDOW_MS = 5_000
/** A row left in 'sending' this long means the process died mid-send; the job retries it. */
export const STALE_SENDING_MS = 5 * 60_000

export type DraftMode = 'new' | 'reply' | 'reply_all' | 'forward'

type StoredAttachment = { filename: string; storagePath: string }

/** A message checked and rendered, ready to be scheduled. Built by prepareSingle/Reply/Forward. */
export interface PreparedSend {
  mode: DraftMode
  fromKey: string
  fromAddress: string
  to: string[]
  cc: string[]
  subject: string
  /** What goes to Resend, signature included. */
  text: string
  html: string
  /** The body as typed, for restoring the draft on undo. */
  body: string
  templateId?: string | null
  headers?: Record<string, string>
  newAttachments: Array<{ filename: string; content: string }>
  storedAttachments: StoredAttachment[]
  threadId?: string
  sourceMessageId?: string
  /** What the thread shows (no signature); new messages use `body`. */
  message?: { bodyText: string; bodyHtml: string }
}

interface ScheduledPayload {
  mode: DraftMode
  fromKey: string
  to: string[]
  cc: string[]
  body: string
  headers?: Record<string, string>
  attachments: StoredAttachment[]
  threadId?: string
  sourceMessageId?: string
  draftId?: string
  message?: { bodyText: string; bodyHtml: string }
}

export class SendAlreadyDispatched extends Error {
  readonly code = 'SEND_ALREADY_DISPATCHED'
  constructor() {
    super('send_already_dispatched')
  }
}

const DraftRecipientsSchema = z.object({
  to: z.array(z.string().email()).max(10),
  cc: z.array(z.string().email()).max(10),
})

export function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean)
}

async function stageAttachments(sendId: string, attachments: PreparedSend['newAttachments']): Promise<StoredAttachment[]> {
  const staged: StoredAttachment[] = []
  for (const [i, att] of attachments.entries()) {
    const safeName = att.filename.replace(/[^A-Za-z0-9._-]/g, '_')
    const storagePath = await saveDocument(`email-outbox/${sendId}/${i}_${safeName}`, Buffer.from(att.content, 'base64'))
    staged.push({ filename: att.filename, storagePath })
  }
  return staged
}

async function ownDraftExists(me: SessionUser, draftId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailDrafts.id })
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, me.id), isNull(emailDrafts.deletedAt)))
  return Boolean(row)
}

function armDispatchTimer(sendId: string, delayMs: number): void {
  const tenantId = currentTenantId()
  const timer = setTimeout(() => {
    runAsTenant(tenantId, () => dispatchScheduledSend(sendId)).catch((err) => {
      console.error(`[email] scheduled send ${sendId}: ${String(err)}`)
    })
  }, delayMs)
  // The job picks the row up after a restart; the timer must not keep the process alive.
  timer.unref?.()
}

export async function scheduleSend(
  me: SessionUser,
  prepared: PreparedSend,
  opts: { draftId?: string; viaDraft?: boolean } = {},
): Promise<{ sendId: string; sendAfter: Date }> {
  // Bulk sending has its own path with a cap and a window; outreach here is one person at a time.
  if (prepared.fromKey === OUTREACH_IDENTITY && prepared.to.length + prepared.cc.length > 1) {
    throw new Error(tr('errors.email.outreachSingleRecipient'))
  }
  await assertCanDeliver({ identityKey: prepared.fromKey, recipients: [...prepared.to, ...prepared.cc], senderUserId: me.id })
  if (opts.draftId && !(await ownDraftExists(me, opts.draftId))) throw new Error(tr('errors.email.draftNotFound'))

  const sendId = randomUUID()
  const staged = await stageAttachments(sendId, prepared.newAttachments)
  const sendAfter = new Date(Date.now() + UNDO_WINDOW_MS)
  const payload: ScheduledPayload = {
    mode: prepared.mode,
    fromKey: prepared.fromKey,
    to: prepared.to,
    cc: prepared.cc,
    body: prepared.body,
    headers: prepared.headers,
    attachments: [...prepared.storedAttachments, ...staged],
    threadId: prepared.threadId,
    sourceMessageId: prepared.sourceMessageId,
    draftId: opts.draftId,
    message: prepared.message,
  }
  const kind = opts.viaDraft ? 'draft' : prepared.mode === 'new' ? 'single' : prepared.mode === 'forward' ? 'forward' : 'reply'
  await db.insert(emailSends).values({
    id: sendId,
    templateId: prepared.templateId ?? null,
    recipient: prepared.to.join(', '),
    fromAddress: prepared.fromAddress,
    subject: prepared.subject,
    bodyText: prepared.text,
    bodyHtml: prepared.html,
    status: 'scheduled',
    sentByUserId: me.id,
    kind,
    sendAfter,
    payload,
  })
  armDispatchTimer(sendId, UNDO_WINDOW_MS)
  return { sendId, sendAfter }
}

// ── The four ways a person sends ─────────────────────────────────────────────

export async function sendNew(
  me: SessionUser,
  input: Parameters<typeof prepareSingle>[1] & { draftId?: string },
): Promise<{ sendId: string; sendAfter: Date }> {
  return scheduleSend(me, await prepareSingle(me, input), { draftId: input.draftId })
}

export async function sendReply(
  me: SessionUser,
  threadId: string,
  input: Parameters<typeof prepareReply>[2] & { draftId?: string },
): Promise<{ sendId: string; sendAfter: Date }> {
  return scheduleSend(me, await prepareReply(me, threadId, input), { draftId: input.draftId })
}

export async function sendForward(
  me: SessionUser,
  messageId: string,
  input: Parameters<typeof prepareForward>[2] & { draftId?: string },
): Promise<{ sendId: string; sendAfter: Date }> {
  return scheduleSend(me, await prepareForward(me, messageId, input), { draftId: input.draftId })
}

/** Sends a saved draft through the path of its mode; the draft is deleted once the email left. */
export async function sendDraft(
  me: SessionUser,
  draftId: string,
  opts: { lastSeenMessageId?: string | null } = {},
): Promise<{ sendId: string; sendAfter: Date }> {
  const [draft] = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, me.id), isNull(emailDrafts.deletedAt)))
  if (!draft) throw new Error(tr('errors.email.draftNotFound'))
  const to = splitAddresses(draft.to)
  const cc = splitAddresses(draft.cc)
  // A draft's recipients are free text saved by autosave; they get the checks the send routes'
  // schemas apply (valid addresses, at most 10 per field) before anything is scheduled.
  if (!DraftRecipientsSchema.safeParse({ to, cc }).success) throw new Error(tr('errors.email.draftInvalidRecipients'))
  const stored = draft.attachments as StoredAttachment[]

  let prepared: PreparedSend
  if (draft.mode === 'reply' || draft.mode === 'reply_all') {
    if (!draft.threadId) throw new Error(tr('errors.email.threadNotFound'))
    prepared = await prepareReply(me, draft.threadId, {
      body: draft.body,
      to: to.length ? to : undefined,
      cc,
      replyAll: draft.mode === 'reply_all',
      lastSeenMessageId: opts.lastSeenMessageId,
    })
  } else if (draft.mode === 'forward') {
    if (!draft.sourceMessageId) throw new Error(tr('errors.email.messageNotFound'))
    if (!to.length) throw new Error(tr('errors.email.draftNoRecipient'))
    // A forward carries the original's files, as in Gmail; the draft holds only the added ones.
    prepared = await prepareForward(me, draft.sourceMessageId, { to, cc, extraBody: draft.body, includeOriginalAttachments: true })
  } else {
    if (!to.length) throw new Error(tr('errors.email.draftNoRecipient'))
    if (!draft.subject) throw new Error(tr('errors.email.draftNoSubject'))
    prepared = await prepareSingle(me, {
      to,
      cc,
      subject: draft.subject,
      body: draft.body,
      from: draft.fromKey,
      templateId: draft.templateId,
    })
  }
  prepared.storedAttachments = [...prepared.storedAttachments, ...stored]
  return scheduleSend(me, prepared, { draftId, viaDraft: true })
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

type SendRow = typeof emailSends.$inferSelect

async function claim(sendId: string): Promise<SendRow | null> {
  const now = new Date()
  const [row] = await db
    .update(emailSends)
    .set({ status: 'sending', updatedAt: now })
    .where(
      and(
        eq(emailSends.id, sendId),
        or(
          and(eq(emailSends.status, 'scheduled'), lte(emailSends.sendAfter, now)),
          and(eq(emailSends.status, 'sending'), lt(emailSends.updatedAt, new Date(now.getTime() - STALE_SENDING_MS))),
        ),
      ),
    )
    .returning()
  return row ?? null
}

/** A failed send goes back into a draft, so the person can open it, fix it and send again. */
async function markFailed(row: SendRow, payload: ScheduledPayload, reason: string): Promise<void> {
  let draftId = payload.draftId
  if (row.sentByUserId) {
    try {
      draftId = await restoreDraft(row.sentByUserId, row, payload)
    } catch (err) {
      console.error(`[email] keeping the draft of failed send ${row.id} failed: ${String(err)}`)
    }
  }
  await db
    .update(emailSends)
    .set({ status: 'failed', errorMessage: reason.slice(0, 500), payload: { ...payload, draftId }, updatedAt: new Date() })
    .where(eq(emailSends.id, row.id))
}

export async function dispatchScheduledSend(sendId: string): Promise<'sent' | 'failed' | 'skipped'> {
  const row = await claim(sendId)
  if (!row) return 'skipped'
  const payload = row.payload as ScheduledPayload

  let files: Array<{ filename: string; content: Buffer }>
  let resendEmailId: string | null
  try {
    await assertCanDeliver({
      identityKey: payload.fromKey,
      recipients: [...payload.to, ...payload.cc],
      senderUserId: row.sentByUserId,
      excludeSendId: row.id,
    })
    files = await Promise.all(payload.attachments.map(async (a) => ({ filename: a.filename, content: await readDocument(a.storagePath) })))
    // Images inserted from the editor become MIME attachments with cid: (the stored bodyHtml keeps the public URL).
    const { html: sendHtml, attachments: inlineImages } = await inlineStoredImages(row.bodyHtml ?? '')
    const result = await sendEmailWithResult({
      to: payload.to,
      cc: payload.cc,
      from: row.fromAddress ?? undefined,
      subject: row.subject,
      text: row.bodyText ?? '',
      html: sendHtml,
      headers: payload.headers,
      attachments: [...inlineImages, ...files],
      idempotencyKey: row.id,
    })
    if (!result.ok) {
      await markFailed(row, payload, result.error ?? tr('errors.email.sendFailed'))
      return 'failed'
    }
    resendEmailId = result.id ?? null
    await db
      .update(emailSends)
      .set({ status: 'sent', errorMessage: null, resendEmailId, updatedAt: new Date() })
      .where(eq(emailSends.id, row.id))
  } catch (err) {
    // The gate's refusals carry the address or the limit in their message; keep it for the toast.
    await markFailed(row, payload, err instanceof Error ? err.message : String(err))
    return 'failed'
  }

  // The email left; recording it on a thread is secondary and must not undo that (regula #7).
  const attachments = files.map((f) => ({ filename: f.filename, content: f.content.toString('base64') }))
  try {
    if (payload.mode === 'reply' || payload.mode === 'reply_all') {
      await recordReplySent({
        threadId: payload.threadId as string,
        fromAddress: row.fromAddress ?? '',
        to: payload.to,
        subject: row.subject,
        bodyText: payload.message?.bodyText ?? '',
        bodyHtml: payload.message?.bodyHtml ?? payload.body,
        resendEmailId,
        sentByUserId: row.sentByUserId,
        attachments,
      })
    } else if (payload.mode === 'forward') {
      await recordForwardSent({
        fromAddress: row.fromAddress ?? '',
        to: payload.to,
        cc: payload.cc,
        subject: row.subject,
        bodyText: payload.message?.bodyText ?? '',
        bodyHtml: payload.message?.bodyHtml ?? payload.body,
        forwardOfMessageId: payload.sourceMessageId ?? null,
        resendEmailId,
        sentByUserId: row.sentByUserId,
        attachments,
      })
    } else {
      await mirrorOutboundMessage({
        fromAddress: row.fromAddress ?? '',
        toAddress: payload.to.join(', '),
        participants: [...payload.to, ...payload.cc],
        subject: row.subject,
        body: payload.body,
        sentByUserId: row.sentByUserId,
        resendEmailId,
        attachments,
      })
    }
  } catch (err) {
    console.error(`[email] recording sent message ${row.id} on its thread failed: ${String(err)}`)
  }

  if (payload.draftId) {
    await db.delete(emailDrafts).where(eq(emailDrafts.id, payload.draftId))
  }
  return 'sent'
}

/** Rows whose timer is gone (restart) or whose send died midway. */
export async function dispatchOverdueSends(limit = 50): Promise<number> {
  // Jobs run as the platform owner; the rows of every company are due, each sent as its company.
  const due = await withRlsBypass(() =>
    db
      .select({ id: emailSends.id, tenantId: emailSends.tenantId })
      .from(emailSends)
      .where(
        or(
          and(eq(emailSends.status, 'scheduled'), lt(emailSends.sendAfter, sql`now() - interval '30 seconds'`)),
          and(eq(emailSends.status, 'sending'), lt(emailSends.updatedAt, new Date(Date.now() - STALE_SENDING_MS))),
        ),
      )
      .orderBy(asc(emailSends.sendAfter))
      .limit(limit),
  )
  let sent = 0
  // One at a time: the outreach cap is re-counted per row.
  for (const row of due) {
    if ((await runAsTenant(row.tenantId, () => dispatchScheduledSend(row.id))) === 'sent') sent++
  }
  return sent
}

// ── Undo and status ──────────────────────────────────────────────────────────

/** Puts the message back in a draft exactly as it was sent, so Undo reopens it. */
async function restoreDraft(ownerUserId: string, row: SendRow, payload: ScheduledPayload): Promise<string> {
  const values = {
    fromKey: payload.fromKey,
    to: payload.to.join(', '),
    cc: payload.cc.join(', '),
    subject: payload.mode === 'new' ? row.subject : '',
    body: payload.body,
    templateId: row.templateId,
    attachments: payload.attachments,
    mode: payload.mode,
    threadId: payload.threadId ?? null,
    sourceMessageId: payload.sourceMessageId ?? null,
    updatedAt: new Date(),
  }
  if (payload.draftId) {
    const [updated] = await db
      .update(emailDrafts)
      .set(values)
      .where(and(eq(emailDrafts.id, payload.draftId), eq(emailDrafts.ownerUserId, ownerUserId)))
      .returning({ id: emailDrafts.id })
    if (updated) return updated.id
  }
  // One reply draft per thread per person (uq_email_drafts_reply): reuse it if one is there.
  if (payload.threadId) {
    const [existing] = await db
      .select({ id: emailDrafts.id })
      .from(emailDrafts)
      .where(
        and(
          eq(emailDrafts.ownerUserId, ownerUserId),
          eq(emailDrafts.threadId, payload.threadId),
          eq(emailDrafts.mode, payload.mode),
          isNull(emailDrafts.deletedAt),
        ),
      )
    if (existing) {
      await db.update(emailDrafts).set(values).where(eq(emailDrafts.id, existing.id))
      return existing.id
    }
  }
  const [created] = await db
    .insert(emailDrafts)
    .values({ ...values, ownerUserId })
    .returning({ id: emailDrafts.id })
  if (!created) throw new Error(tr('errors.email.draftInsertFailed'))
  return created.id
}

/** null = no such send of this person (404). */
export async function cancelScheduledSend(me: SessionUser, sendId: string): Promise<{ draftId: string } | null> {
  const [row] = await db
    .update(emailSends)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(emailSends.id, sendId), eq(emailSends.sentByUserId, me.id), eq(emailSends.status, 'scheduled')))
    .returning()
  if (!row) {
    const [own] = await db
      .select({ id: emailSends.id })
      .from(emailSends)
      .where(and(eq(emailSends.id, sendId), eq(emailSends.sentByUserId, me.id)))
    if (!own) return null
    throw new SendAlreadyDispatched()
  }
  return { draftId: await restoreDraft(me.id, row, row.payload as ScheduledPayload) }
}

export interface SendStatus {
  status: SendRow['status']
  error: string | null
  /** The thread the message landed on, once sent. */
  threadId: string | null
  draftId: string | null
}

export async function getSendStatus(me: SessionUser, sendId: string): Promise<SendStatus | null> {
  const [row] = await db
    .select({
      status: emailSends.status,
      error: emailSends.errorMessage,
      resendEmailId: emailSends.resendEmailId,
      payload: emailSends.payload,
    })
    .from(emailSends)
    .where(and(eq(emailSends.id, sendId), eq(emailSends.sentByUserId, me.id)))
  if (!row) return null
  const payload = row.payload as ScheduledPayload | null
  let threadId = payload?.mode === 'reply' || payload?.mode === 'reply_all' ? (payload.threadId ?? null) : null
  if (!threadId && row.resendEmailId) {
    const [message] = await db
      .select({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .where(eq(emailMessages.resendEmailId, row.resendEmailId))
    threadId = message?.threadId ?? null
  }
  return { status: row.status, error: row.error, threadId, draftId: payload?.draftId ?? null }
}
