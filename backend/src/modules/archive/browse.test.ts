/**
 * Archive browsing: pagination and filters, search, details, stars, recent. pg real
 * (test/setup.ts), R2 mocked like in service.test.ts.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
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
vi.mock('../../shared/lib/thumbnail.js', () => ({
  generatePdfThumbnail: vi.fn().mockResolvedValue(null),
}))

const service = await import('./service.js')

const userIds: string[] = []
const ana = await createTestUser('browse ana', userIds)
const bob = await createTestUser('browse bob', userIds)

async function folder(me: typeof ana, name: string, parentId?: string) {
  return (await service.createFolder(me, name, parentId))!
}

async function file(me: typeof ana, input: { folderId: string; name: string; mimeType?: string }) {
  return (await service.createFileRecord(me, {
    mimeType: 'text/plain',
    sizeBytes: 10,
    r2Key: `archive/qa-browse-${crypto.randomUUID()}`,
    tags: [],
    ...input,
  }))!
}

afterAll(async () => {
  const folderRows = await db
    .select({ id: archiveFolders.id })
    .from(archiveFolders)
    .where(inArray(archiveFolders.ownerUserId, userIds))
  const ids = folderRows.map((f) => f.id)
  if (ids.length) {
    await db.delete(archiveFiles).where(inArray(archiveFiles.folderId, ids))
    await db.delete(archiveFolders).where(inArray(archiveFolders.id, ids))
  }
  await db.delete(archiveTrashBatches).where(inArray(archiveTrashBatches.deletedByUserId, userIds))
  await cleanupTestUsers(userIds)
})

describe('listFiles', () => {
  it('paginates with a total from SQL', async () => {
    const many = await folder(ana, 'Pagination')
    for (let i = 0; i < 60; i++) await file(ana, { folderId: many.id, name: `item-${String(i).padStart(2, '0')}.txt` })

    const first = await service.listFiles(ana, { folderId: many.id, page: 1, sort: 'name' })
    expect(first.items).toHaveLength(50)
    expect(first.total).toBe(60)
    expect(first.pageSize).toBe(50)

    const second = await service.listFiles(ana, { folderId: many.id, page: 2, sort: 'name' })
    expect(second.items).toHaveLength(10)
    expect(second.total).toBe(60)
    expect(second.items[0]?.name).toBe('item-50.txt')
  })

  it('filters by type', async () => {
    const mixed = await folder(ana, 'Types')
    const pdf = await file(ana, { folderId: mixed.id, name: 'a.pdf', mimeType: 'application/pdf' })
    await file(ana, { folderId: mixed.id, name: 'b.png', mimeType: 'image/png' })
    await file(ana, { folderId: mixed.id, name: 'c.bin', mimeType: 'application/octet-stream' })

    const pdfs = await service.listFiles(ana, { folderId: mixed.id, page: 1, type: 'pdf' })
    expect(pdfs.items.map((f) => f.id)).toEqual([pdf.id])
    expect(pdfs.total).toBe(1)

    const others = await service.listFiles(ana, { folderId: mixed.id, page: 1, type: 'other' })
    expect(others.items.map((f) => f.name)).toEqual(['c.bin'])
  })

  it('treats % in q as a literal, not a wildcard', async () => {
    const lit = await folder(ana, 'Literal')
    await file(ana, { folderId: lit.id, name: 'plain.txt' })
    const result = await service.listFiles(ana, { folderId: lit.id, page: 1, q: '%' })
    expect(result.items).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})

describe('searchArchive', () => {
  it('finds files and folders ignoring case and diacritics, folders first', async () => {
    const inv = await folder(ana, 'Facturare')
    const invoice = await file(ana, { folderId: inv.id, name: 'Factură.pdf', mimeType: 'application/pdf' })

    const results = await service.searchArchive(ana, { q: 'factura' })
    expect(results.map((r) => [r.kind, r.id])).toEqual([
      ['folder', inv.id],
      ['file', invoice.id],
    ])
  })

  it('drops folders when a file-only filter is set', async () => {
    const results = await service.searchArchive(ana, { q: 'factura', type: 'pdf' })
    expect(results.every((r) => r.kind === 'file')).toBe(true)
    expect(results).toHaveLength(1)
  })

  it('does not return another person\'s items', async () => {
    const mine = await folder(ana, 'Izolat-secret')
    await file(ana, { folderId: mine.id, name: 'izolat-secret.txt' })
    expect(await service.searchArchive(bob, { q: 'izolat-secret' })).toEqual([])
  })
})

describe('details', () => {
  it('lists a share inherited from an ancestor', async () => {
    const parent = await folder(ana, 'Shared parent')
    const child = await folder(ana, 'Shared child', parent.id)
    await service.setShare(ana, parent.id, bob.id, 'edit')

    const details = await service.getFolderDetails(ana, child.id)
    expect(details.access).toEqual([
      { userId: bob.id, name: 'QA browse bob', level: 'edit', inherited: true, inheritedFrom: { id: parent.id, name: 'Shared parent' } },
    ])
    expect(details.owner?.id).toBe(ana.id)
    expect(details.path.map((p) => p.id).slice(-2)).toEqual([parent.id, child.id])

    const asBob = await service.getFolderDetails(bob, child.id)
    expect(asBob.path.map((p) => p.id)).toEqual([parent.id, child.id])
  })

  it('does not name an ancestor the reader cannot open', async () => {
    const top = await folder(ana, 'Hidden top')
    const mid = await folder(ana, 'Given to bob', top.id)
    const carol = await createTestUser('browse carol', userIds)
    await service.setShare(ana, top.id, carol.id, 'view')
    await service.setShare(ana, mid.id, bob.id, 'view')
    const asBob = await service.getFolderDetails(bob, mid.id)
    const carolRow = asBob.access.find((a) => a.userId === carol.id)
    expect(carolRow).toMatchObject({ inherited: true, inheritedFrom: null })
    expect(JSON.stringify(asBob)).not.toContain('Hidden top')
  })

  it('keeps the strongest level when a person has shares at two levels', async () => {
    const parent = await folder(ana, 'Strong parent')
    const child = await folder(ana, 'Strong child', parent.id)
    await service.setShare(ana, parent.id, bob.id, 'edit')
    await service.setShare(ana, child.id, bob.id, 'view')
    const details = await service.getFolderDetails(ana, child.id)
    expect(details.access).toHaveLength(1)
    expect(details.access[0]?.level).toBe('edit')
  })

  it('file details carry the creator and the folder owner', async () => {
    const f = await folder(ana, 'Details folder')
    const row = await file(ana, { folderId: f.id, name: 'd.txt' })
    const details = await service.getFileDetails(ana, row.id)
    expect(details.owner?.id).toBe(ana.id)
    expect(details.starred).toBe(false)
    await expect(service.getFileDetails(bob, row.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })
})

describe('stars', () => {
  it('rejects a star on a file the person cannot see', async () => {
    const f = await folder(ana, 'Private')
    const row = await file(ana, { folderId: f.id, name: 'private.txt' })
    await expect(service.setStar(bob, 'file', row.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('stars are idempotent, personal and show in listFolders and listStars', async () => {
    const f = await folder(ana, 'Starred folder')
    const row = await file(ana, { folderId: f.id, name: 'starred.txt' })
    await service.setStar(ana, 'folder', f.id)
    await service.setStar(ana, 'folder', f.id)
    await service.setStar(ana, 'file', row.id)

    const listed = (await service.listFolders(ana)).find((x) => x.id === f.id)
    expect(listed?.starred).toBe(true)
    expect(listed?.itemCount).toBe(1)

    const stars = await service.listStars(ana)
    expect(stars.folders.map((x) => x.id)).toContain(f.id)
    expect(stars.files.map((x) => x.id)).toContain(row.id)
    expect((await service.listStars(bob)).files).toEqual([])

    await service.removeStar(ana, 'file', row.id)
    expect((await service.listStars(ana)).files.map((x) => x.id)).not.toContain(row.id)
  })
})

describe('recent', () => {
  it('says the level, so a view share shows no write actions', async () => {
    const shared = await folder(ana, 'Recent view share')
    const row = await file(ana, { folderId: shared.id, name: 'recent-view.txt' })
    await service.setShare(ana, shared.id, bob.id, 'view')
    expect((await service.listRecent(bob)).find((x) => x.id === row.id)?.level).toBe('view')
    expect((await service.listRecent(ana)).find((x) => x.id === row.id)?.level).toBe('edit')
  })

  it('excludes files from another person\'s space', async () => {
    const f = await folder(ana, 'Recent folder')
    const row = await file(ana, { folderId: f.id, name: 'recent-ana.txt' })
    expect((await service.listRecent(ana)).map((x) => x.id)).toContain(row.id)
    expect((await service.listRecent(bob)).map((x) => x.id)).not.toContain(row.id)
  })
})

describe('folder color', () => {
  it('accepts a color and null', async () => {
    const f = await folder(ana, 'Colored')
    expect((await service.updateFolder(ana, f.id, { color: 3 }))?.color).toBe(3)
    expect((await service.updateFolder(ana, f.id, { color: null }))?.color).toBeNull()
  })
})
