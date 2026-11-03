import { sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { MAX_REF_FILE_BYTES, RefFileTooLargeError, registerRefType } from '../../shared/lib/entity-refs.js'
import { downloadFromR2 } from '../../shared/lib/r2.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { accessibleFoldersCte } from './access.js'

async function visibleFiles(me: SessionUser, ids: string[]) {
  if (!me.features.includes('arhiva.view')) return []
  return db.execute<{ id: string; folderId: string; name: string; mimeType: string; sizeBytes: number; r2Key: string }>(sql`
    ${accessibleFoldersCte(me)}
    SELECT f."id", f."folder_id" AS "folderId", f."name", f."mime_type" AS "mimeType",
           f."size_bytes"::float8 AS "sizeBytes", f."r2_key" AS "r2Key"
      FROM "archive_files" f
      JOIN access a ON a.id = f."folder_id" AND a.lvl >= 1
     WHERE f."id" IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND f."deleted_at" IS NULL
  `)
}

// The file is copied into the conversation, so the card keeps working after the original moves
// or the sender's share is taken back. Size is checked before anything is read from R2.
registerRefType('archive_file', {
  kind: 'personal',
  async snapshot(refId, sender, { preview }) {
    const [file] = await visibleFiles(sender, [refId])
    if (!file) return null
    if (file.sizeBytes > MAX_REF_FILE_BYTES) throw new RefFileTooLargeError()
    const card = { title: file.name, contentType: file.mimeType, sizeBytes: file.sizeBytes, folderId: file.folderId }
    if (preview) return { card }
    const buffer = await downloadFromR2(file.r2Key)
    return { card, file: { filename: file.name, contentType: file.mimeType, buffer } }
  },
  async resolve(refIds, reader) {
    const visible = new Set((await visibleFiles(reader, refIds)).map((r) => r.id))
    return new Map(refIds.map((id) => [id, { canOpen: visible.has(id) }]))
  },
})
