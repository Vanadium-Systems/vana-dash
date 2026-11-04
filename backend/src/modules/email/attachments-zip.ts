import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { db } from '../../shared/db/client.js'
import { emailAttachments, emailMessages } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { readDocument } from '../../shared/lib/storage.js'
import { mailboxAddresses, messageVisibleTo } from './mailboxes.js'

export const ZIP_LIMIT_MB = 100
const ZIP_LIMIT_BYTES = ZIP_LIMIT_MB * 1024 * 1024

/** `a.pdf`, `a (2).pdf`, `a (3).pdf`; separators are stripped so a name can't become a zip path. */
export function dedupeFileNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw) => {
    const clean = raw.replace(/[/\\]/g, '_').trim() || 'file'
    const dot = clean.lastIndexOf('.')
    const [base, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, '']
    let candidate = clean
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

export function zipFileName(subject: string): string {
  const base = subject.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 60).trim()
  return `${base || 'attachments'}.zip`
}

export type MessageZipResult =
  | { kind: 'not-found' }
  | { kind: 'too-large' }
  | { kind: 'ok'; buffer: Buffer; fileName: string }

export async function buildMessageAttachmentsZip(me: SessionUser, messageId: string): Promise<MessageZipResult> {
  const visible = messageVisibleTo(await mailboxAddresses(me))
  const [message] = await db
    .select({ subject: emailMessages.subject })
    .from(emailMessages)
    .where(and(eq(emailMessages.id, messageId), isNull(emailMessages.deletedAt), visible))
  if (!message) return { kind: 'not-found' }

  // Inline images belong to the HTML body, same exclusion as the thread list.
  const rows = await db
    .select({ storagePath: emailAttachments.storagePath, filename: emailAttachments.filename })
    .from(emailAttachments)
    .where(
      and(
        eq(emailAttachments.messageId, messageId),
        isNull(emailAttachments.deletedAt),
        sql`${emailAttachments.disposition} IS DISTINCT FROM 'inline'`,
      ),
    )
    .orderBy(asc(emailAttachments.createdAt))
  if (rows.length === 0) return { kind: 'not-found' }

  const buffers: Buffer[] = []
  let total = 0
  for (const row of rows) {
    const content = await readDocument(row.storagePath)
    total += content.length
    if (total > ZIP_LIMIT_BYTES) return { kind: 'too-large' }
    buffers.push(content)
  }

  const names = dedupeFileNames(rows.map((row) => row.filename))
  const entries: Record<string, Uint8Array> = {}
  names.forEach((name, i) => {
    entries[name] = new Uint8Array(buffers[i] as Buffer)
  })
  // Stored, not deflated: attachments are mostly PDFs and images already, and the box has one CPU.
  return { kind: 'ok', buffer: Buffer.from(zipSync(entries, { level: 0 })), fileName: zipFileName(message.subject) }
}
