/**
 * The Archive Trash (trash.ts), bulk moves (bulk.ts) and the nightly purge, on real Postgres.
 * R2 is mocked: what matters here is which rows are marked, restored or removed, and which keys
 * reach R2.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolders, archiveTrashBatches } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'

vi.mock('../../shared/lib/r2.js', () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  deleteManyFromR2: vi.fn().mockResolvedValue(undefined),
  downloadFromR2: vi.fn().mockResolvedValue(Buffer.from('bytes')),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned-fake'),
  uploadToR2: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../shared/lib/thumbnail.js', () => ({ generatePdfThumbnail: vi.fn().mockResolvedValue(null) }))

const { deleteManyFromR2 } = await import('../../shared/lib/r2.js')
const service = await import('./service.js')
const trash = await import('./trash.js')
const bulk = await import('./bulk.js')
const { runTrashPurge } = await import('../../jobs/trash-purge.js')

const userIds: string[] = []
const owner = await createTestUser('trash owner', userIds)
const colleague = await createTestUser('trash colleague', userIds)
const outsider = await createTestUser('trash outsider', userIds)

async function folder(me: typeof owner, name: string, parentId?: string) {
  return (await service.createFolder(me, name, parentId))!
}

async function file(me: typeof owner, folderId: string, name = 'f.txt', extra: { thumbnailR2Key?: string; sizeBytes?: number } = {}) {
  return (await service.createFileRecord(me, {
    folderId,
    name,
    mimeType: 'text/plain',
    sizeBytes: extra.sizeBytes ?? 10,
    r2Key: `archive/qa-trash-${crypto.randomUUID()}`,
    thumbnailR2Key: extra.thumbnailR2Key,
    tags: [],
  }))!
}

async function rootOf(me: typeof owner) {
  return (await service.listSpaces(me)).own!.id
}

async function expire(batchId: string) {
  await db.update(archiveTrashBatches).set({ purgeAfter: new Date(Date.now() - 1000) }).where(eq(archiveTrashBatches.id, batchId))
}

beforeEach(() => {
  vi.mocked(deleteManyFromR2).mockReset().mockResolvedValue(undefined)
})

afterAll(async () => {
  const ids = (await db.select({ id: archiveFolders.id }).from(archiveFolders).where(inArray(archiveFolders.ownerUserId, userIds))).map((f) => f.id)
  if (ids.length) {
    await db.delete(archiveFiles).where(inArray(archiveFiles.folderId, ids))
    await db.delete(archiveFolders).where(inArray(archiveFolders.id, ids))
  }
  await db.delete(archiveTrashBatches).where(inArray(archiveTrashBatches.deletedByUserId, userIds))
  await cleanupTestUsers(userIds)
})

describe('deleting into the Trash', () => {
  it('a folder with a cycle in stale data is deleted without looping', async () => {
    const a = await folder(owner, 'Cycle A')
    const b = await folder(owner, 'Cycle B', a.id)
    const c = await folder(owner, 'Cycle C', b.id)
    // A → B → C with A's parent set to C: a cycle no route can create (wouldCreateCycle), only
    // stale data. Each folder has one parent, so a reachable cycle must go through A itself.
    await db.execute(sql`UPDATE archive_folders SET parent_id = ${c.id} WHERE id = ${a.id}`)
    const result = await trash.trashFolder(owner, a.id)
    expect(result.itemCount).toBe(3)
  })

  it('the space root cannot be deleted', async () => {
    await expect(trash.trashFolder(owner, await rootOf(owner))).rejects.toThrow(service.ArchiveConflictError)
  })

  it('an edit share on a folder lets you delete inside it, not the folder itself', async () => {
    const shared = await folder(owner, 'Shared edit')
    const inside = await file(owner, shared.id, 'inside.txt')
    await service.setShare(owner, shared.id, colleague.id, 'edit')
    await expect(trash.trashFolder(colleague, shared.id)).rejects.toThrow(service.ArchiveNotFoundError)
    await expect(trash.trashFile(colleague, inside.id)).resolves.toMatchObject({ itemCount: 1 })
  })

  it('a file deleted inside a selected folder goes with the folder in bulk', async () => {
    const parent = await folder(owner, 'Bulk parent')
    const inner = await file(owner, parent.id, 'inner.txt')
    const { batches } = await trash.trashMany(owner, [
      { type: 'folder', id: parent.id },
      { type: 'file', id: inner.id },
    ])
    expect(batches).toHaveLength(1)
    expect(batches[0]?.itemCount).toBe(2)
  })

  it('bulk delete with one item without the right deletes nothing', async () => {
    const mine = await folder(owner, 'Bulk mine')
    const f = await file(owner, mine.id)
    const theirs = await file(outsider, await rootOf(outsider), 'theirs.txt')
    await expect(trash.trashMany(owner, [{ type: 'file', id: f.id }, { type: 'file', id: theirs.id }])).rejects.toMatchObject({
      itemId: theirs.id,
    })
    const [row] = await db.select().from(archiveFiles).where(eq(archiveFiles.id, f.id))
    expect(row?.deletedAt).toBeNull()
  })

  it('an upload into a folder in the Trash is refused', async () => {
    const gone = await folder(owner, 'Gone')
    await trash.trashFolder(owner, gone.id)
    await expect(file(owner, gone.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })
})

describe('listing and restoring', () => {
  it('the Trash shows the space owner and editors of the parent, not others', async () => {
    const shared = await folder(owner, 'Trash visibility')
    await service.setShare(owner, shared.id, colleague.id, 'edit')
    const f = await file(owner, shared.id, 'visible.txt')
    const { batchId } = await trash.trashFile(owner, f.id)

    expect((await trash.listTrash(owner)).some((b) => b.id === batchId)).toBe(true)
    expect((await trash.listTrash(colleague)).some((b) => b.id === batchId)).toBe(true)
    expect((await trash.listTrash(outsider)).some((b) => b.id === batchId)).toBe(false)
    await expect(trash.restoreBatch(outsider, batchId)).rejects.toThrow(service.ArchiveNotFoundError)

    // A view share is not enough to see what was thrown away there.
    await service.setShare(owner, shared.id, colleague.id, 'view')
    expect((await trash.listTrash(colleague)).some((b) => b.id === batchId)).toBe(false)
  })

  it('restores a folder with its subtree, and nothing deleted before it', async () => {
    const top = await folder(owner, 'Restore top')
    const sub = await folder(owner, 'Restore sub', top.id)
    const early = await file(owner, sub.id, 'early.txt')
    const late = await file(owner, sub.id, 'late.txt')
    const earlyBatch = await trash.trashFile(owner, early.id)
    const { batchId } = await trash.trashFolder(owner, top.id)

    await trash.restoreBatch(owner, batchId)
    const rows = await db.select().from(archiveFiles).where(inArray(archiveFiles.id, [early.id, late.id]))
    expect(rows.find((r) => r.id === late.id)?.deletedAt).toBeNull()
    expect(rows.find((r) => r.id === early.id)?.deletedBatchId).toBe(earlyBatch.batchId)
  })

  it('when the original folder is in the Trash too, the batch goes to the space root', async () => {
    const parent = await folder(owner, 'Restore parent gone')
    const f = await file(owner, parent.id, 'orphan.txt')
    const fileBatch = await trash.trashFile(owner, f.id)
    await trash.trashFolder(owner, parent.id)

    const result = await trash.restoreBatch(owner, fileBatch.batchId)
    expect(result.restoredTo.id).toBe(await rootOf(owner))
  })

  it('a name clash gets the restored suffix, before the extension', async () => {
    const dir = await folder(owner, 'Clash dir')
    const old = await file(owner, dir.id, 'contract.pdf')
    const { batchId } = await trash.trashFile(owner, old.id)
    await file(owner, dir.id, 'contract.pdf')
    const result = await trash.restoreBatch(owner, batchId)
    expect(result.name).toMatch(/^contract \(.+\)\.pdf$/)
  })
})

describe('purging', () => {
  it('purge sends the file and its thumbnail to R2, then removes the rows', async () => {
    const dir = await folder(owner, 'Purge dir')
    const f = await file(owner, dir.id, 'p.pdf', { thumbnailR2Key: `archive/thumbnails/qa-${crypto.randomUUID()}.jpg` })
    const { batchId } = await trash.trashFolder(owner, dir.id)
    await trash.purgeBatches([batchId])
    expect(deleteManyFromR2).toHaveBeenCalledWith(expect.arrayContaining([f.r2Key, f.thumbnailR2Key]))
    expect(await db.select().from(archiveFolders).where(eq(archiveFolders.id, dir.id))).toHaveLength(0)
  })

  it('an older batch inside the purged folder is purged with it', async () => {
    const dir = await folder(owner, 'Nested purge')
    const f = await file(owner, dir.id, 'nested.txt')
    const fileBatch = await trash.trashFile(owner, f.id)
    const { batchId } = await trash.trashFolder(owner, dir.id)
    const done = await trash.purgeBatches([batchId])
    expect(done.batches).toBe(2)
    const [b] = await db.select().from(archiveTrashBatches).where(eq(archiveTrashBatches.id, fileBatch.batchId))
    expect(b?.deletedAt).not.toBeNull()
  })

  it('an R2 error keeps the batch for the next run', async () => {
    const f = await file(owner, await rootOf(owner), 'r2-error.txt')
    const { batchId } = await trash.trashFile(owner, f.id)
    await expire(batchId)
    vi.mocked(deleteManyFromR2).mockRejectedValueOnce(new Error('R2 down'))

    const first = await runTrashPurge()
    expect(first.failed).toBeGreaterThanOrEqual(1)
    expect(await db.select().from(archiveFiles).where(eq(archiveFiles.id, f.id))).toHaveLength(1)

    await runTrashPurge()
    expect(await db.select().from(archiveFiles).where(eq(archiveFiles.id, f.id))).toHaveLength(0)
  })

  it('the nightly run stops at the object cap', async () => {
    const big = await folder(owner, 'Cap big')
    await db.insert(archiveFiles).values(
      Array.from({ length: 2001 }, (_, i) => ({
        folderId: big.id,
        name: `cap-${i}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 1,
        r2Key: `archive/qa-cap-${crypto.randomUUID()}`,
        tags: [],
      })),
    )
    const small = await file(owner, await rootOf(owner), 'cap-small.txt')
    const bigBatch = await trash.trashFolder(owner, big.id)
    const smallBatch = await trash.trashFile(owner, small.id)
    await expire(bigBatch.batchId)
    await expire(smallBatch.batchId)
    // The big batch is older, so it goes first and fills the cap on its own.
    await db.update(archiveTrashBatches).set({ purgeAfter: new Date(Date.now() - 60_000) }).where(eq(archiveTrashBatches.id, bigBatch.batchId))

    await runTrashPurge()
    const [smallRow] = await db.select().from(archiveTrashBatches).where(eq(archiveTrashBatches.id, smallBatch.batchId))
    expect(smallRow?.deletedAt).toBeNull()
  })
})

describe('bulk move and undo', () => {
  it('moves and puts back exactly', async () => {
    const from = await folder(owner, 'Move from')
    const to = await folder(owner, 'Move to')
    const f = await file(owner, from.id, 'moved.txt')
    const sub = await folder(owner, 'Moved sub', from.id)
    const moved = await bulk.bulkMove(owner, [{ type: 'file', id: f.id }, { type: 'folder', id: sub.id }], to.id)
    expect(moved.moved).toBe(2)
    await bulk.putBack(owner, moved.previous)
    const [row] = await db.select().from(archiveFiles).where(eq(archiveFiles.id, f.id))
    const [folderRow] = await db.select().from(archiveFolders).where(eq(archiveFolders.id, sub.id))
    expect(row?.folderId).toBe(from.id)
    expect(folderRow?.parentId).toBe(from.id)
  })

  it('one item without the right moves nothing', async () => {
    const to = await folder(owner, 'Move target')
    const mine = await file(owner, to.id, 'stay.txt')
    const from = await folder(owner, 'Move source')
    const theirs = await file(outsider, await rootOf(outsider), 'not-mine.txt')
    await expect(
      bulk.bulkMove(owner, [{ type: 'file', id: mine.id }, { type: 'file', id: theirs.id }], from.id),
    ).rejects.toMatchObject({ itemId: theirs.id })
    const [row] = await db.select().from(archiveFiles).where(eq(archiveFiles.id, mine.id))
    expect(row?.folderId).toBe(to.id)
  })

  it('a folder cannot be moved into its own subtree', async () => {
    const a = await folder(owner, 'Into self A')
    const b = await folder(owner, 'Into self B', a.id)
    await expect(bulk.bulkMove(owner, [{ type: 'folder', id: a.id }], b.id)).rejects.toThrow(service.ArchiveConflictError)
  })
})
