import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { prospects, prospectTasks, prospectVoiceNotes, users } from '../../shared/db/schema/index.js'
import { findVisibleProspect } from '../../shared/lib/prospect-access.js'
import type { SessionUser } from '../../shared/lib/session.js'

type Me = SessionUser

export const MAX_VOICE_BYTES = 25 * 1024 * 1024
export const MAX_VOICE_SECONDS = 900

export const UpdateVoiceNoteSchema = z.object({ caption: z.string().trim().max(200).nullable() })

export class VoiceNotYoursError extends Error {
  readonly code = 'VOICE_NOT_YOURS'
}
export class VoiceTaskInvalidError extends Error {
  readonly code = 'VOICE_TASK_INVALID'
}

export const isVoiceStorageOn = () => {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = config.r2
  return Boolean(accountId && accessKeyId && secretAccessKey && bucketName)
}

/** The mime and extension from the first bytes, or null when it is not audio we accept. The mime
 *  the browser sends is ignored: a renamed PNG must not end up in the bucket as audio. */
export function sniffAudio(head: Buffer): { mime: string; ext: string } | null {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return { mime: 'audio/webm', ext: 'webm' }
  if (head.subarray(0, 4).toString('latin1') === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' }
  if (head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' }
  if (head.subarray(0, 3).toString('latin1') === 'ID3') return { mime: 'audio/mpeg', ext: 'mp3' }
  if (head.length >= 2 && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) return { mime: 'audio/mpeg', ext: 'mp3' }
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WAVE') {
    return { mime: 'audio/wav', ext: 'wav' }
  }
  return null
}

const isAdmin = (me: Me) => me.role?.kind === 'admin' || me.isPlatformAdmin

const voiceColumns = {
  id: prospectVoiceNotes.id,
  taskId: prospectVoiceNotes.taskId,
  mime: prospectVoiceNotes.mime,
  sizeBytes: prospectVoiceNotes.sizeBytes,
  durationSeconds: prospectVoiceNotes.durationSeconds,
  caption: prospectVoiceNotes.caption,
  createdAt: prospectVoiceNotes.createdAt,
  authorUserId: prospectVoiceNotes.authorUserId,
}

export async function listVoiceNotes(me: Me, prospectId: string) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  const rows = await db
    .select({ ...voiceColumns, authorName: users.displayName, authorEmail: users.email })
    .from(prospectVoiceNotes)
    .leftJoin(users, eq(users.id, prospectVoiceNotes.authorUserId))
    .where(and(eq(prospectVoiceNotes.prospectId, prospectId), isNull(prospectVoiceNotes.deletedAt)))
    .orderBy(asc(prospectVoiceNotes.createdAt))
  return rows.map(({ authorEmail, authorName, ...row }) => ({
    ...row,
    authorName: authorName || authorEmail,
    canManage: row.authorUserId === me.id || isAdmin(me),
  }))
}

/** A visible prospect is enough, like for text notes. */
export async function assertVoiceTarget(me: Me, prospectId: string, taskId?: string) {
  if (!(await findVisibleProspect(me, prospectId))) return false
  if (taskId) {
    const [task] = await db
      .select({ id: prospectTasks.id })
      .from(prospectTasks)
      .where(and(eq(prospectTasks.id, taskId), eq(prospectTasks.prospectId, prospectId), isNull(prospectTasks.deletedAt)))
    if (!task) throw new VoiceTaskInvalidError()
  }
  return true
}

export async function createVoiceNote(
  me: Me,
  prospectId: string,
  input: { r2Key: string; mime: string; sizeBytes: number; durationSeconds: number; caption?: string | null; taskId?: string },
) {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(prospectVoiceNotes)
      .values({
        prospectId,
        authorUserId: me.id,
        taskId: input.taskId ?? null,
        r2Key: input.r2Key,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        durationSeconds: Math.min(MAX_VOICE_SECONDS, Math.max(0, Math.round(input.durationSeconds))),
        caption: input.caption || null,
      })
      .returning(voiceColumns)
    if (!created) throw new Error('voice note insert returned nothing')
    await tx.update(prospects).set({ lastActivityAt: new Date() }).where(eq(prospects.id, prospectId))
    return created
  })
}

async function findManageable(me: Me, prospectId: string, voiceId: string) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  const [existing] = await db
    .select()
    .from(prospectVoiceNotes)
    .where(and(eq(prospectVoiceNotes.id, voiceId), eq(prospectVoiceNotes.prospectId, prospectId), isNull(prospectVoiceNotes.deletedAt)))
  return existing
}

export async function updateVoiceCaption(me: Me, prospectId: string, voiceId: string, caption: string | null) {
  const existing = await findManageable(me, prospectId, voiceId)
  if (!existing) return undefined
  if (existing.authorUserId !== me.id && !isAdmin(me)) throw new VoiceNotYoursError()
  const [updated] = await db
    .update(prospectVoiceNotes)
    .set({ caption: caption || null, updatedAt: new Date() })
    .where(eq(prospectVoiceNotes.id, voiceId))
    .returning(voiceColumns)
  return updated
}

/** Soft delete; returns the R2 key so the route removes the object after the commit. */
export async function deleteVoiceNote(me: Me, prospectId: string, voiceId: string) {
  const existing = await findManageable(me, prospectId, voiceId)
  if (!existing) return undefined
  if (existing.authorUserId !== me.id && !isAdmin(me)) throw new VoiceNotYoursError()
  await db.update(prospectVoiceNotes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(prospectVoiceNotes.id, voiceId))
  return { r2Key: existing.r2Key }
}

export async function voiceNoteKey(me: Me, prospectId: string, voiceId: string) {
  return (await findManageable(me, prospectId, voiceId))?.r2Key
}
