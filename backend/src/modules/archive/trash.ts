import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolders, archiveStars, archiveTrashBatches } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { tr } from '../../shared/lib/i18n.js'
import { deleteManyFromR2 } from '../../shared/lib/r2.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { EDIT_ACCESS, accessibleFoldersCte, ensureSpaceRootOf, folderAccessLevel } from './access.js'
import { ArchiveConflictError, ArchiveNotFoundError, requireFile, requireFolder } from './service.js'

// The Trash: a delete marks the rows (`deleted_at` + `deleted_batch_id`) and writes one batch;
// restoring clears the marks, purging removes rows and R2 objects. Nothing leaves R2 before the
// batch is purged, so a delete stays reversible for 30 days.

const TRASH_DAYS = 30

export interface TrashResult {
  batchId: string
  itemCount: number
  totalBytes: number
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function insertBatch(
  tx: Tx,
  me: SessionUser,
  input: { id: string; rootType: 'file' | 'folder'; rootId: string; originalParentId: string; itemCount: number; totalBytes: number },
) {
  await tx.insert(archiveTrashBatches).values({
    ...input,
    deletedByUserId: me.id,
    purgeAfter: sql`now() + make_interval(days => ${TRASH_DAYS})`,
  })
}

async function trashFileTx(tx: Tx, me: SessionUser, file: { id: string; folderId: string; sizeBytes: number }) {
  const batchId = randomUUID()
  await tx
    .update(archiveFiles)
    .set({ deletedAt: new Date(), deletedBatchId: batchId })
    .where(and(eq(archiveFiles.id, file.id), isNull(archiveFiles.deletedAt)))
  await insertBatch(tx, me, {
    id: batchId,
    rootType: 'file',
    rootId: file.id,
    originalParentId: file.folderId,
    itemCount: 1,
    totalBytes: file.sizeBytes,
  })
  return { batchId, itemCount: 1, totalBytes: file.sizeBytes }
}

async function trashFolderTx(tx: Tx, me: SessionUser, folder: { id: string; parentId: string }): Promise<TrashResult> {
  const batchId = randomUUID()
  // UNION, not UNION ALL: a cycle in stale data must not make the recursion endless (CLAUDE.md).
  const [counts] = await tx.execute<{ folders: number; files: number; bytes: number }>(sql`
    WITH RECURSIVE sub AS (
      SELECT id FROM archive_folders WHERE id = ${folder.id} AND deleted_at IS NULL
      UNION
      SELECT f.id FROM archive_folders f JOIN sub s ON f.parent_id = s.id WHERE f.deleted_at IS NULL
    ), del_folders AS (
      UPDATE archive_folders SET deleted_at = now(), deleted_batch_id = ${batchId}
       WHERE id IN (SELECT id FROM sub)
      RETURNING id
    ), del_files AS (
      UPDATE archive_files SET deleted_at = now(), deleted_batch_id = ${batchId}
       WHERE folder_id IN (SELECT id FROM sub) AND deleted_at IS NULL
      RETURNING size_bytes
    )
    SELECT (SELECT COUNT(*) FROM del_folders)::int AS folders,
           (SELECT COUNT(*) FROM del_files)::int AS files,
           (SELECT COALESCE(SUM(size_bytes), 0) FROM del_files)::bigint AS bytes
  `)
  const itemCount = (counts?.folders ?? 0) + (counts?.files ?? 0)
  const totalBytes = Number(counts?.bytes ?? 0)
  await insertBatch(tx, me, {
    id: batchId,
    rootType: 'folder',
    rootId: folder.id,
    originalParentId: folder.parentId,
    itemCount,
    totalBytes,
  })
  return { batchId, itemCount, totalBytes }
}

/** A folder can be deleted by whoever can edit the folder it sits in: a share on the folder
 *  itself lets you work inside it, not remove it from its owner's tree. */
async function checkFolderDeletable(me: SessionUser, folderId: string) {
  const folder = await requireFolder(me, folderId, EDIT_ACCESS)
  if (!folder.parentId) throw new ArchiveConflictError(tr('errors.archive.spaceRootDelete'))
  if ((await folderAccessLevel(me, folder.parentId)) < EDIT_ACCESS) throw new ArchiveNotFoundError(folderId)
  return { id: folder.id, parentId: folder.parentId }
}

export async function trashFile(me: SessionUser, id: string): Promise<TrashResult> {
  const file = await requireFile(me, id, EDIT_ACCESS)
  return db.transaction((tx) => trashFileTx(tx, me, file))
}

export async function trashFolder(me: SessionUser, id: string): Promise<TrashResult> {
  const folder = await checkFolderDeletable(me, id)
  return db.transaction((tx) => trashFolderTx(tx, me, folder))
}

export interface BulkItem {
  type: 'file' | 'folder'
  id: string
}

/** One batch per selected root. Items inside another selected folder go with that folder, so
 *  restoring the folder brings them back too. All checks run first: one item without the right
 *  and nothing is deleted. */
export async function trashMany(me: SessionUser, items: BulkItem[]): Promise<{ batches: TrashResult[] }> {
  const folderIds = items.filter((i) => i.type === 'folder').map((i) => i.id)
  const files: { id: string; folderId: string; sizeBytes: number }[] = []
  const folders: { id: string; parentId: string }[] = []
  for (const item of items) {
    if (item.type === 'file') files.push(await requireFile(me, item.id, EDIT_ACCESS).catch(() => notFound(item.id)))
    else folders.push(await checkFolderDeletable(me, item.id).catch((err) => rethrowWithId(err, item.id)))
  }

  const covered = new Set<string>()
  if (folderIds.length > 0) {
    const rows = await db.execute<{ id: string; rootId: string }>(sql`
      WITH RECURSIVE sub AS (
        SELECT id, id AS root_id FROM archive_folders
         WHERE id IN (${sql.join(folderIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND deleted_at IS NULL
        UNION
        SELECT f.id, s.root_id FROM archive_folders f JOIN sub s ON f.parent_id = s.id WHERE f.deleted_at IS NULL
      )
      SELECT id, root_id AS "rootId" FROM sub WHERE id <> root_id
    `)
    for (const r of rows) covered.add(r.id)
  }

  return db.transaction(async (tx) => {
    const batches: TrashResult[] = []
    for (const folder of folders) {
      if (!covered.has(folder.id)) batches.push(await trashFolderTx(tx, me, folder))
    }
    for (const file of files) {
      if (!covered.has(file.folderId) && !folderIds.includes(file.folderId)) batches.push(await trashFileTx(tx, me, file))
    }
    return { batches }
  })
}

function notFound(id: string): never {
  throw new ArchiveNotFoundError(id)
}

function rethrowWithId(err: unknown, id: string): never {
  if (err instanceof ArchiveNotFoundError) throw new ArchiveNotFoundError(id)
  throw err
}

// ── Listing and restoring ───────────────────────────────────────────────

export interface TrashEntry {
  id: string
  rootType: 'file' | 'folder'
  rootId: string
  rootName: string
  mimeType: string | null
  parentId: string
  parentName: string
  itemCount: number
  totalBytes: number
  deletedBy: { id: string; name: string }
  deletedAt: Date
  purgeAfter: Date
}

/**
 * Who sees a batch: the owner of the space it was deleted from, and whoever can still edit the
 * folder it was deleted from. The deleted rows are outside every access CTE, so the check is on
 * the original parent. Losing access to that folder hides the batch, so the Trash never shows
 * names from a folder you can no longer open.
 */
function visibleBatchesSql(me: SessionUser, extra = sql``) {
  return sql`
    ${accessibleFoldersCte(me)}
    SELECT b.id, b.root_type AS "rootType", b.root_id AS "rootId",
           COALESCE(fi.name, fo.name, '') AS "rootName", fi.mime_type AS "mimeType",
           p.id AS "parentId", p.name AS "parentName", p.deleted_at IS NOT NULL AS "parentGone",
           p.owner_user_id AS "parentOwnerId",
           b.item_count AS "itemCount", b.total_bytes AS "totalBytes",
           b.deleted_by_user_id AS "deletedById",
           COALESCE(NULLIF(u.display_name, ''), u.email) AS "deletedByName",
           b.created_at AS "deletedAt", b.purge_after AS "purgeAfter"
      FROM archive_trash_batches b
      JOIN archive_folders p ON p.id = b.original_parent_id
      JOIN users u ON u.id = b.deleted_by_user_id
      LEFT JOIN archive_files fi ON b.root_type = 'file' AND fi.id = b.root_id
      LEFT JOIN archive_folders fo ON b.root_type = 'folder' AND fo.id = b.root_id
     WHERE b.deleted_at IS NULL
       AND (p.owner_user_id = ${me.id}
            OR (p.deleted_at IS NULL AND p.id IN (SELECT id FROM access WHERE lvl >= ${EDIT_ACCESS})))
       ${extra}
  `
}

type BatchRow = {
  id: string
  rootType: 'file' | 'folder'
  rootId: string
  rootName: string
  mimeType: string | null
  parentId: string
  parentName: string
  parentGone: boolean
  parentOwnerId: string
  itemCount: number
  totalBytes: number | string
  deletedById: string
  deletedByName: string
  deletedAt: Date | string
  purgeAfter: Date | string
}

export async function listTrash(me: SessionUser): Promise<TrashEntry[]> {
  const rows = await db.execute<BatchRow>(sql`${visibleBatchesSql(me)} ORDER BY b.created_at DESC LIMIT 500`)
  return rows.map((r) => ({
    id: r.id,
    rootType: r.rootType,
    rootId: r.rootId,
    rootName: r.rootName,
    mimeType: r.mimeType,
    parentId: r.parentId,
    parentName: r.parentName,
    itemCount: r.itemCount,
    totalBytes: Number(r.totalBytes),
    deletedBy: { id: r.deletedById, name: r.deletedByName },
    deletedAt: new Date(r.deletedAt),
    purgeAfter: new Date(r.purgeAfter),
  }))
}

async function requireBatch(me: SessionUser, batchId: string): Promise<BatchRow> {
  const [row] = await db.execute<BatchRow>(visibleBatchesSql(me, sql`AND b.id = ${batchId}`))
  if (!row) throw new ArchiveNotFoundError(batchId, tr('errors.archive.trashNotFound'))
  return row
}

function withRestoredSuffix(name: string, isFile: boolean): string {
  const suffix = tr('errors.archive.restoredSuffix')
  const dot = isFile ? name.lastIndexOf('.') : -1
  return dot > 0 ? `${name.slice(0, dot)} ${suffix}${name.slice(dot)}` : `${name} ${suffix}`
}

/**
 * Puts the batch back where it was deleted from. When that folder is itself in the Trash, the
 * batch goes to the root of the same space instead (restoring never needs a second restore).
 * A live item with the same name gets the "(restored)" suffix on the restored one.
 */
export async function restoreBatch(me: SessionUser, batchId: string) {
  const batch = await requireBatch(me, batchId)
  const targetId = batch.parentGone ? await ensureSpaceRootOf(batch.parentOwnerId) : batch.parentId
  const [target] = await db
    .select({ id: archiveFolders.id, name: archiveFolders.name, ownerUserId: archiveFolders.ownerUserId })
    .from(archiveFolders)
    .where(eq(archiveFolders.id, targetId))
  if (!target) throw new ArchiveNotFoundError(batchId)

  const isFile = batch.rootType === 'file'
  const clash = isFile
    ? await db
        .select({ id: archiveFiles.id })
        .from(archiveFiles)
        .where(and(eq(archiveFiles.folderId, target.id), eq(archiveFiles.name, batch.rootName), isNull(archiveFiles.deletedAt)))
    : await db
        .select({ id: archiveFolders.id })
        .from(archiveFolders)
        .where(and(eq(archiveFolders.parentId, target.id), eq(archiveFolders.name, batch.rootName), isNull(archiveFolders.deletedAt)))
  const name = clash.length > 0 ? withRestoredSuffix(batch.rootName, isFile) : batch.rootName

  await db.transaction(async (tx) => {
    if (isFile) {
      await tx
        .update(archiveFiles)
        .set({ folderId: target.id, name, deletedAt: null, deletedBatchId: null })
        .where(and(eq(archiveFiles.id, batch.rootId), eq(archiveFiles.deletedBatchId, batchId)))
    } else {
      // The subtree takes the owner of the folder it lands in, as a move inside the space would.
      await tx
        .update(archiveFolders)
        .set({ ownerUserId: target.ownerUserId })
        .where(eq(archiveFolders.deletedBatchId, batchId))
      await tx
        .update(archiveFolders)
        .set({ parentId: target.id, name })
        .where(and(eq(archiveFolders.id, batch.rootId), eq(archiveFolders.deletedBatchId, batchId)))
      await tx
        .update(archiveFolders)
        .set({ deletedAt: null, deletedBatchId: null })
        .where(eq(archiveFolders.deletedBatchId, batchId))
      await tx
        .update(archiveFiles)
        .set({ deletedAt: null, deletedBatchId: null })
        .where(eq(archiveFiles.deletedBatchId, batchId))
    }
    await tx.update(archiveTrashBatches).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(archiveTrashBatches.id, batchId))
  })
  await recordAudit({
    action: 'arhiva.cos.restaurat',
    entityType: isFile ? 'archive_file' : 'archive_folder',
    entityId: batch.rootId,
    changes: { folder: [batch.parentId, target.id] },
  })
  return { restoredTo: { id: target.id, name: target.name }, name }
}

/** Permanent delete from the Trash. The R2 work runs after the response, like the nightly purge. */
export async function purgeBatchNow(me: SessionUser, batchId: string) {
  const batch = await requireBatch(me, batchId)
  await db.update(archiveTrashBatches).set({ purgeAfter: new Date() }).where(eq(archiveTrashBatches.id, batchId))
  await recordAudit({
    action: 'arhiva.cos.sters_definitiv',
    entityType: batch.rootType === 'file' ? 'archive_file' : 'archive_folder',
    entityId: batch.rootId,
    changes: { elemente: [batch.itemCount, null] },
  })
  setImmediate(() => {
    purgeBatches([batchId]).catch((err) => console.error(`[archive-trash] purge ${batchId} failed:`, err))
  })
  return { itemCount: batch.itemCount, totalBytes: Number(batch.totalBytes) }
}

// ── Purging ─────────────────────────────────────────────────────────────

/**
 * Older batches can sit inside a folder of a newer one (a file deleted, then its folder). Their
 * rows hold the folder in place through the `restrict` foreign keys, so they are purged together.
 */
async function withNestedBatches(batchIds: string[]): Promise<string[]> {
  const all = new Set(batchIds)
  for (let round = 0; round < 20; round++) {
    const ids = [...all]
    const rows = await db.execute<{ batchId: string }>(sql`
      SELECT DISTINCT x.batch_id AS "batchId" FROM (
        SELECT af.deleted_batch_id AS batch_id FROM archive_files af
          JOIN archive_folders f ON f.id = af.folder_id
         WHERE f.deleted_batch_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        UNION
        SELECT c.deleted_batch_id FROM archive_folders c
          JOIN archive_folders f ON f.id = c.parent_id
         WHERE f.deleted_batch_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      ) x
      JOIN archive_trash_batches b ON b.id = x.batch_id AND b.deleted_at IS NULL
    `)
    const before = all.size
    for (const r of rows) all.add(r.batchId)
    if (all.size === before) break
  }
  return [...all]
}

/** Number of R2 objects a batch holds (files + thumbnails), for the nightly cap. */
export async function countBatchObjects(batchId: string): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`(COUNT(*) + COUNT(${archiveFiles.thumbnailR2Key}))::int`,
    })
    .from(archiveFiles)
    .where(eq(archiveFiles.deletedBatchId, batchId))
  return row?.n ?? 0
}

/**
 * Removes the batches for good: R2 objects first, then the rows. An R2 error throws before any
 * row is touched, so the batch stays in the Trash and the next run retries (deleting a key that
 * is already gone is not an error in S3). Returns the number of R2 objects deleted.
 */
export async function purgeBatches(batchIds: string[]): Promise<{ batches: number; objects: number }> {
  if (batchIds.length === 0) return { batches: 0, objects: 0 }
  const ids = await withNestedBatches(batchIds)

  // A live row inside a batch's folder would block the folder delete after R2 is already gone.
  const [live] = await db.execute<{ n: number }>(sql`
    SELECT ((SELECT COUNT(*) FROM archive_files af JOIN archive_folders f ON f.id = af.folder_id
              WHERE f.deleted_batch_id IN ${uuidList(ids)} AND af.deleted_at IS NULL)
          + (SELECT COUNT(*) FROM archive_folders c JOIN archive_folders f ON f.id = c.parent_id
              WHERE f.deleted_batch_id IN ${uuidList(ids)} AND c.deleted_at IS NULL))::int AS n
  `)
  if ((live?.n ?? 0) > 0) throw new Error(`archive-trash: ${live?.n} live rows under batches ${ids.join(',')}`)

  const files = await db
    .select({ id: archiveFiles.id, r2Key: archiveFiles.r2Key, thumb: archiveFiles.thumbnailR2Key })
    .from(archiveFiles)
    .where(inArray(archiveFiles.deletedBatchId, ids))
  const keys = files.flatMap((f) => (f.thumb ? [f.r2Key, f.thumb] : [f.r2Key]))
  if (keys.length > 0) await deleteManyFromR2(keys)

  await db.transaction(async (tx) => {
    const folderIds = (
      await tx.select({ id: archiveFolders.id }).from(archiveFolders).where(inArray(archiveFolders.deletedBatchId, ids))
    ).map((f) => f.id)
    const itemIds = [...files.map((f) => f.id), ...folderIds]
    if (itemIds.length > 0) await tx.delete(archiveStars).where(inArray(archiveStars.itemId, itemIds))
    await tx.delete(archiveFiles).where(inArray(archiveFiles.deletedBatchId, ids))
    // One statement for the whole set: the `restrict` check on `parent_id` runs after it, when
    // the children are gone too.
    await tx.delete(archiveFolders).where(inArray(archiveFolders.deletedBatchId, ids))
    await tx
      .update(archiveTrashBatches)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(inArray(archiveTrashBatches.id, ids))
  })
  return { batches: ids.length, objects: keys.length }
}

function uuidList(ids: string[]) {
  return sql`(${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`
}

/** Batches past their 30 days, oldest first. */
export async function listExpiredBatches(limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: archiveTrashBatches.id })
    .from(archiveTrashBatches)
    .where(and(isNull(archiveTrashBatches.deletedAt), sql`${archiveTrashBatches.purgeAfter} < now()`))
    .orderBy(archiveTrashBatches.purgeAfter)
    .limit(limit)
  return rows.map((r) => r.id)
}
