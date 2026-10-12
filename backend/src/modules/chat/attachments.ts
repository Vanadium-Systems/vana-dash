import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { messageAttachments, messages } from '../../shared/db/schema/index.js'
import { deleteFromR2, downloadFromR2, getPresignedDownloadUrl, uploadToR2 } from '../../shared/lib/r2.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { isMember } from './service.js'

// Atașamente în Mesaje (PLAN.md C3). R2, ca Arhiva: fișierul nu mai trece prin memoria
// containerului de 1 vCPU decât la upload (bufferizat, ca să putem impune limita pe
// dimensiune) și la descărcare. Prefixul `chat/` primește prefixul firmei în Etapa 3.
//
// Fără miniaturi generate: `message_attachments.thumbnail_path` rămâne null. O imagine
// trimisă se afișează direct din endpoint (same-origin, cu verificare de membru), iar o
// miniatură ar cere încă o dependență de decodare de imagine, pe un VPS mic, pentru un
// câștig pe care interfața îl acoperă cu `object-contain` și lazy loading.

// 50 MB: un video de 20-30 de secunde de pe telefon trece de 15 MB.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const UNATTACHED_TTL_HOURS = 24

// Singurele tipuri servite `inline`. Restul — inclusiv `.svg` și `.html` — se descarcă: un
// SVG sau un HTML deschis din aceeași origine, cu cookie de sesiune, ar rula script în
// tab-ul aplicației (SEC). `nosniff` merge pe ambele căi.
const INLINE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/**
 * Numele vine de la browser, deci de la om: slash-urile ar rescrie cheia R2, iar caracterele de
 * control ar ajunge în `Content-Disposition` la descărcare. Slash-ul se vede în realitate
 * (nume de fișier de la Windows); `
` nu poate ajunge prin `multipart` — e separatorul
 * câmpului — deci filtrul pe control e doar plasa de siguranță, nu o gaură reparată.
 */
function sanitizeFilename(name: string): string {
  const clean = name.replace(/[/\\]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (clean.length > 0 ? clean : 'fisier').slice(0, 120)
}

export interface StoredAttachment {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
}

/** Încarcă un fișier bufferizat și îl înregistrează neatribuit (message_id null). */
export async function uploadAttachment(
  me: SessionUser,
  file: { filename: string; contentType: string; buffer: Buffer },
): Promise<StoredAttachment> {
  const filename = sanitizeFilename(file.filename)
  const contentType = file.contentType || 'application/octet-stream'
  const storagePath = `chat/${randomUUID()}-${filename}`

  await uploadToR2(storagePath, Readable.from(file.buffer), contentType)
  const [row] = await db
    .insert(messageAttachments)
    .values({
      uploadedByUserId: me.id,
      storagePath,
      filename,
      contentType,
      sizeBytes: file.buffer.byteLength,
    })
    .returning({ id: messageAttachments.id, sizeBytes: messageAttachments.sizeBytes })

  return { id: row!.id, filename, contentType, sizeBytes: row!.sizeBytes }
}

// Videoul nu trece prin VPS la vizionare: playerul cere bucăți (Range) și ar descărca tot
// fișierul din R2 în memorie la fiecare cerere. Îl trimitem spre un URL presemnat, după
// verificarea de membru, iar R2 servește direct cu Range.
const VIDEO_CONTENT_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp'])
const VIDEO_URL_TTL_SECONDS = 60 * 60

export type AttachmentFile =
  | { kind: 'redirect'; url: string }
  | { kind: 'file'; buffer: Buffer; filename: string; contentType: string; inline: boolean }

/**
 * Conținutul unui atașament, pentru un om care e membru în conversația mesajului. Un
 * atașament încă neatribuit (upload netrimis) e citibil doar de cel care l-a încărcat.
 */
export async function readAttachment(
  viewerId: string,
  attachmentId: string,
  forDownload = false,
): Promise<AttachmentFile | null> {
  const [row] = await db
    .select({
      storagePath: messageAttachments.storagePath,
      filename: messageAttachments.filename,
      contentType: messageAttachments.contentType,
      uploadedByUserId: messageAttachments.uploadedByUserId,
      conversationId: messages.conversationId,
    })
    .from(messageAttachments)
    .leftJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(and(eq(messageAttachments.id, attachmentId), isNull(messageAttachments.deletedAt)))
  if (!row) return null

  if (row.uploadedByUserId !== viewerId) {
    if (!row.conversationId || !(await isMember(row.conversationId, viewerId))) return null
  }

  if (!forDownload && VIDEO_CONTENT_TYPES.has(row.contentType)) {
    return { kind: 'redirect', url: await getPresignedDownloadUrl(row.storagePath, VIDEO_URL_TTL_SECONDS) }
  }

  return {
    kind: 'file',
    buffer: await downloadFromR2(row.storagePath),
    filename: row.filename,
    contentType: row.contentType,
    inline: INLINE_CONTENT_TYPES.has(row.contentType),
  }
}

/** Curățenia (job zilnic): încărcate, niciodată trimise, mai vechi de 24h. */
export async function purgeUnattachedAttachments(): Promise<number> {
  const rows = await db
    .select({ id: messageAttachments.id, storagePath: messageAttachments.storagePath })
    .from(messageAttachments)
    .where(
      and(
        isNull(messageAttachments.messageId),
        isNull(messageAttachments.deletedAt),
        lt(messageAttachments.createdAt, new Date(Date.now() - UNATTACHED_TTL_HOURS * 3600_000)),
      ),
    )
  if (rows.length === 0) return 0

  for (const row of rows) {
    await deleteFromR2(row.storagePath).catch(() => {})
  }
  await db.delete(messageAttachments).where(inArray(messageAttachments.id, rows.map((r) => r.id)))
  return rows.length
}
