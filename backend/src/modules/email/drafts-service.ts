import { and, desc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { emailAttachments, emailDrafts, emailMessages, emailThreads } from '../../shared/db/schema/index.js'
import { saveDocument } from '../../shared/lib/storage.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { assertCanSendFrom, mailboxAddresses, messageVisibleTo, threadVisibleTo } from './mailboxes.js'
import type { DraftUpdateSchema, DraftUpsertSchema } from './drafts-schema.js'
import { tr } from '../../shared/lib/i18n.js'

type DraftRow = typeof emailDrafts.$inferSelect
type DraftAttachment = { filename: string; storagePath: string }

export class DraftChangedError extends Error {
  readonly code = 'DRAFT_CHANGED'
  constructor(readonly updatedAt: Date) {
    super('Draft was changed elsewhere')
  }
}

/** Thread or source message the person cannot see (route answers 404). */
export class DraftRefNotFound extends Error {}

/** storagePath that is not already on the draft or its source message (route answers 400). */
export class DraftAttachmentRejected extends Error {}

export async function listDrafts(me: SessionUser, threadId?: string) {
  return db
    .select()
    .from(emailDrafts)
    .where(
      and(
        isNull(emailDrafts.deletedAt),
        eq(emailDrafts.ownerUserId, me.id),
        threadId ? eq(emailDrafts.threadId, threadId) : undefined,
      ),
    )
    .orderBy(desc(emailDrafts.updatedAt))
}

export async function getDraft(me: SessionUser, id: string): Promise<DraftRow | null> {
  const [row] = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, id), isNull(emailDrafts.deletedAt), eq(emailDrafts.ownerUserId, me.id)))
  return row ?? null
}

async function assertThreadVisible(me: SessionUser, threadId: string) {
  const [thread] = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), isNull(emailThreads.deletedAt), threadVisibleTo(await mailboxAddresses(me))))
  if (!thread) throw new DraftRefNotFound(tr('errors.email.threadNotFound'))
}

async function assertMessageVisible(me: SessionUser, messageId: string) {
  const [message] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.id, messageId), isNull(emailMessages.deletedAt), messageVisibleTo(await mailboxAddresses(me))))
  if (!message) throw new DraftRefNotFound(tr('errors.email.messageNotFound'))
}

/** Normalizes a draft's attachments: new ones (base64 `content`) are saved to disk now, already
 *  saved ones (`storagePath`) are left alone. A `storagePath` is accepted only if it is already on
 *  the draft or on a forward's source message: otherwise a client could get any file on disk sent. */
async function persistAttachments(
  draftId: string,
  attachments: z.infer<typeof DraftUpsertSchema>['attachments'],
  existing: unknown,
  sourceMessageId: string | null,
): Promise<DraftAttachment[]> {
  if (!attachments) return []
  const known = new Set((Array.isArray(existing) ? (existing as DraftAttachment[]) : []).map((a) => a.storagePath))
  const requested = attachments.flatMap((att) => ('storagePath' in att ? [att.storagePath] : []))
  if (sourceMessageId && requested.some((path) => !known.has(path))) {
    const source = await db
      .select({ storagePath: emailAttachments.storagePath })
      .from(emailAttachments)
      .where(and(eq(emailAttachments.messageId, sourceMessageId), isNull(emailAttachments.deletedAt)))
    for (const { storagePath } of source) known.add(storagePath)
  }
  const result: DraftAttachment[] = []
  for (const [i, att] of attachments.entries()) {
    if ('storagePath' in att) {
      if (!known.has(att.storagePath)) throw new DraftAttachmentRejected(tr('errors.email.draftAttachmentRejected'))
      result.push({ filename: att.filename, storagePath: att.storagePath })
    } else {
      const safeName = att.filename.replace(/[^A-Za-z0-9._-]/g, '_')
      const storagePath = await saveDocument(`email-drafts/${draftId}/${i}_${safeName}`, Buffer.from(att.content, 'base64'))
      result.push({ filename: att.filename, storagePath })
    }
  }
  return result
}

export async function createDraft(me: SessionUser, input: z.infer<typeof DraftUpsertSchema>): Promise<DraftRow> {
  assertCanSendFrom(me, input.fromKey)
  if (input.threadId) await assertThreadVisible(me, input.threadId)
  if (input.sourceMessageId) await assertMessageVisible(me, input.sourceMessageId)

  if (input.threadId) {
    // The unique index allows one draft per thread and mode; reuse it instead of failing the insert.
    const [existing] = await db
      .select({ id: emailDrafts.id })
      .from(emailDrafts)
      .where(
        and(
          eq(emailDrafts.ownerUserId, me.id),
          eq(emailDrafts.threadId, input.threadId),
          eq(emailDrafts.mode, input.mode),
          isNull(emailDrafts.deletedAt),
        ),
      )
    if (existing) {
      const updated = await updateDraft(me, existing.id, input)
      if (updated) return updated
    }
  }

  const [row] = await db
    .insert(emailDrafts)
    .values({
      ownerUserId: me.id,
      fromKey: input.fromKey,
      to: input.to,
      subject: input.subject,
      body: input.body,
      cc: input.cc,
      mode: input.mode,
      threadId: input.threadId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      templateId: input.templateId ?? null,
      attachments: [],
    })
    .returning()
  if (!row) throw new Error(tr('errors.email.draftInsertFailed'))

  if (input.attachments?.length) {
    try {
      const attachments = await persistAttachments(row.id, input.attachments, [], row.sourceMessageId)
      const [updated] = await db.update(emailDrafts).set({ attachments }).where(eq(emailDrafts.id, row.id)).returning()
      return updated ?? row
    } catch (err) {
      await db.delete(emailDrafts).where(eq(emailDrafts.id, row.id))
      throw err
    }
  }
  return row
}

export async function updateDraft(me: SessionUser, id: string, input: z.infer<typeof DraftUpdateSchema>): Promise<DraftRow | null> {
  const existing = await getDraft(me, id)
  if (!existing) return null
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
    throw new DraftChangedError(existing.updatedAt)
  }

  if (input.threadId && input.threadId !== existing.threadId) await assertThreadVisible(me, input.threadId)
  if (input.sourceMessageId && input.sourceMessageId !== existing.sourceMessageId) await assertMessageVisible(me, input.sourceMessageId)

  const changes: Record<string, unknown> = { updatedAt: new Date() }
  if (input.fromKey !== undefined) changes.fromKey = input.fromKey
  if (input.to !== undefined) changes.to = input.to
  if (input.cc !== undefined) changes.cc = input.cc
  if (input.subject !== undefined) changes.subject = input.subject
  if (input.body !== undefined) changes.body = input.body
  if (input.templateId !== undefined) changes.templateId = input.templateId
  if (input.mode !== undefined) changes.mode = input.mode
  if (input.threadId !== undefined) changes.threadId = input.threadId
  if (input.sourceMessageId !== undefined) changes.sourceMessageId = input.sourceMessageId
  if (input.attachments !== undefined) {
    const sourceMessageId = input.sourceMessageId !== undefined ? input.sourceMessageId : existing.sourceMessageId
    changes.attachments = await persistAttachments(id, input.attachments, existing.attachments, sourceMessageId)
  }

  const [row] = await db.update(emailDrafts).set(changes).where(eq(emailDrafts.id, id)).returning()
  return row ?? null
}

export async function deleteDraft(me: SessionUser, id: string): Promise<boolean> {
  const [row] = await db
    .update(emailDrafts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(emailDrafts.id, id), isNull(emailDrafts.deletedAt), eq(emailDrafts.ownerUserId, me.id)))
    .returning({ id: emailDrafts.id })
  return Boolean(row)
}
