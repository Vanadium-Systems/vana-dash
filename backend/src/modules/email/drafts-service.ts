import { and, desc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { emailDrafts } from '../../shared/db/schema/index.js'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { assertCanSendFrom } from './mailboxes.js'
import type { DraftUpdateSchema, DraftUpsertSchema } from './drafts-schema.js'
import { sendSingle } from './service.js'
import { tr } from '../../shared/lib/i18n.js'

type DraftRow = typeof emailDrafts.$inferSelect
type DraftAttachment = { filename: string; storagePath: string }

export async function listDrafts(me: SessionUser) {
  return db
    .select()
    .from(emailDrafts)
    .where(and(isNull(emailDrafts.deletedAt), eq(emailDrafts.ownerUserId, me.id)))
    .orderBy(desc(emailDrafts.updatedAt))
}

export async function getDraft(me: SessionUser, id: string): Promise<DraftRow | null> {
  const [row] = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, id), isNull(emailDrafts.deletedAt), eq(emailDrafts.ownerUserId, me.id)))
  return row ?? null
}

/** Normalizează atașamentele unui draft — cele noi (`content` base64) se salvează pe disc acum,
 *  cele deja salvate (`storagePath`) rămân neatinse — evită re-scriere la fiecare autosave. */
async function persistAttachments(
  draftId: string,
  attachments: z.infer<typeof DraftUpsertSchema>['attachments'],
): Promise<DraftAttachment[]> {
  if (!attachments) return []
  const result: DraftAttachment[] = []
  for (const [i, att] of attachments.entries()) {
    if ('storagePath' in att) {
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
  const [row] = await db
    .insert(emailDrafts)
    .values({
      ownerUserId: me.id,
      fromKey: input.fromKey,
      to: input.to,
      subject: input.subject,
      body: input.body,
      templateId: input.templateId ?? null,
      attachments: [],
    })
    .returning()
  if (!row) throw new Error(tr('errors.email.draftInsertFailed'))

  if (input.attachments?.length) {
    const attachments = await persistAttachments(row.id, input.attachments)
    const [updated] = await db.update(emailDrafts).set({ attachments }).where(eq(emailDrafts.id, row.id)).returning()
    return updated ?? row
  }
  return row
}

export async function updateDraft(me: SessionUser, id: string, input: z.infer<typeof DraftUpdateSchema>): Promise<DraftRow | null> {
  const existing = await getDraft(me, id)
  if (!existing) return null

  const changes: Record<string, unknown> = { updatedAt: new Date() }
  if (input.fromKey !== undefined) changes.fromKey = input.fromKey
  if (input.to !== undefined) changes.to = input.to
  if (input.subject !== undefined) changes.subject = input.subject
  if (input.body !== undefined) changes.body = input.body
  if (input.templateId !== undefined) changes.templateId = input.templateId
  if (input.attachments !== undefined) changes.attachments = await persistAttachments(id, input.attachments)

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

/** Trimite draftul prin path-ul existent (sendSingle — semnătură, HTML, atașamente incluse),
 *  apoi șterge draftul. Atașamentele deja salvate se re-încarcă din storage ca base64. */
export async function sendDraft(me: SessionUser, id: string) {
  const draft = await getDraft(me, id)
  if (!draft) throw new Error(tr('errors.email.draftNotFound'))
  if (!draft.to) throw new Error(tr('errors.email.draftNoRecipient'))
  if (!draft.subject) throw new Error(tr('errors.email.draftNoSubject'))

  const attachments = draft.attachments as DraftAttachment[]
  const encoded = await Promise.all(
    attachments.map(async (a) => ({ filename: a.filename, content: (await readDocument(a.storagePath)).toString('base64') })),
  )

  const result = await sendSingle(me, {
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    from: draft.fromKey,
    templateId: draft.templateId ?? undefined,
    attachments: encoded.length ? encoded : undefined,
  })

  await db.delete(emailDrafts).where(eq(emailDrafts.id, id))
  return result
}
