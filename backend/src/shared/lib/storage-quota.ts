import { sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'

/** The bucket is company-wide, so the limit is too (R2's free tier is per bucket). */
export class StorageFullError extends Error {
  constructor(
    readonly usedBytes: number,
    readonly limitBytes: number,
  ) {
    super('archive storage full')
  }
}

// One row per object kept in R2 that has a size in the DB. Archive files count soft-deleted ones too
// (the objects stay until the Trash purges them); voice notes and chat attachments only while live
// (a deleted message keeps its attachment rows, so those still count). `quarterly-packages/*.zip`
// has no size in the DB and is reported as uncounted instead.
const STORAGE_ROWS = sql`
  SELECT 'arhiva'::text AS source, af.size_bytes AS bytes, f.owner_user_id AS user_id, af.folder_id AS folder_id
  FROM archive_files af JOIN archive_folders f ON f.id = af.folder_id
  UNION ALL
  SELECT 'note_vocale', size_bytes, author_user_id, NULL::uuid FROM prospect_voice_notes WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'mesaje', size_bytes, uploaded_by_user_id, NULL::uuid FROM message_attachments WHERE deleted_at IS NULL
`

export type StorageSource = 'arhiva' | 'note_vocale' | 'mesaje'

export interface StorageUsage {
  limitBytes: number
  usedBytes: number
  uncounted: string[]
  bySource: { source: StorageSource; bytes: number; files: number }[]
  byPerson: { userId: string | null; name: string | null; bytes: number; bySource: Record<StorageSource, number> }[]
  topFolders: { folderId: string; name: string; ownerName: string | null; bytes: number; files: number }[]
}

const SOURCES: StorageSource[] = ['arhiva', 'note_vocale', 'mesaje']

export async function storageUsage(): Promise<StorageUsage> {
  const [sources, people, folders] = await Promise.all([
    db.execute<{ source: StorageSource; bytes: string; files: string }>(sql`
      WITH r AS (${STORAGE_ROWS})
      SELECT source, SUM(bytes)::bigint AS bytes, COUNT(*)::bigint AS files FROM r GROUP BY source
    `),
    db.execute<{ userId: string | null; name: string | null; source: StorageSource; bytes: string }>(sql`
      WITH r AS (${STORAGE_ROWS})
      SELECT r.user_id AS "userId", u.display_name AS name, r.source, SUM(r.bytes)::bigint AS bytes
      FROM r LEFT JOIN users u ON u.id = r.user_id
      GROUP BY r.user_id, u.display_name, r.source
    `),
    db.execute<{ folderId: string; name: string; ownerName: string | null; bytes: string; files: string }>(sql`
      WITH r AS (${STORAGE_ROWS})
      SELECT r.folder_id AS "folderId", f.name, u.display_name AS "ownerName",
             SUM(r.bytes)::bigint AS bytes, COUNT(*)::bigint AS files
      FROM r JOIN archive_folders f ON f.id = r.folder_id LEFT JOIN users u ON u.id = f.owner_user_id
      GROUP BY r.folder_id, f.name, u.display_name
      ORDER BY bytes DESC, r.folder_id
      LIMIT 10
    `),
  ])

  const bySource = SOURCES.map((source) => {
    const row = Array.from(sources).find((r) => r.source === source)
    return { source, bytes: Number(row?.bytes ?? 0), files: Number(row?.files ?? 0) }
  })

  // Pivoted from the (person, source) groups SQL returned; at most people x 3 rows.
  const byUser = new Map<string, StorageUsage['byPerson'][number]>()
  for (const row of Array.from(people)) {
    const key = row.userId ?? 'system'
    const entry = byUser.get(key) ?? {
      userId: row.userId,
      name: row.name,
      bytes: 0,
      bySource: { arhiva: 0, note_vocale: 0, mesaje: 0 },
    }
    entry.bySource[row.source] = Number(row.bytes)
    entry.bytes += Number(row.bytes)
    byUser.set(key, entry)
  }

  return {
    limitBytes: config.r2.freeTierLimitGb * 1024 ** 3,
    usedBytes: bySource.reduce((sum, s) => sum + s.bytes, 0),
    uncounted: ['quarterly-packages'],
    bySource,
    byPerson: [...byUser.values()].sort((a, b) => b.bytes - a.bytes),
    topFolders: Array.from(folders).map((f) => ({ ...f, bytes: Number(f.bytes), files: Number(f.files) })),
  }
}

/**
 * Throws when `extraBytes` more would pass the bucket limit. Counts the same objects as
 * `storageUsage`: archive rows (soft-deleted too), live voice notes and live chat attachments.
 */
export async function assertStorageAvailable(extraBytes: number): Promise<void> {
  const [row] = Array.from(
    await db.execute<{ total: string }>(sql`WITH r AS (${STORAGE_ROWS}) SELECT COALESCE(SUM(bytes), 0)::bigint AS total FROM r`),
  )
  const usedBytes = Number(row?.total ?? 0)
  const limitBytes = config.r2.freeTierLimitGb * 1024 ** 3
  if (usedBytes + extraBytes > limitBytes) throw new StorageFullError(usedBytes, limitBytes)
}
