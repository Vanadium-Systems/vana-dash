/**
 * modules/archive/service.ts — integration test, pg real (test/setup.ts).
 * shared/lib/r2.ts mockuit (fără bucket R2 real disponibil în CI/dev) — service-ul nu ar
 * trebui să apeleze R2 decât la download (getPresignedDownloadUrl) și la ștergere permanentă
 * (deleteFromR2); restul (foldere, listare, search, soft delete) e DB pur.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolders } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'

vi.mock('../../shared/lib/r2.js', () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  downloadFromR2: vi.fn().mockResolvedValue(Buffer.from('fake file bytes')),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned-fake'),
  uploadToR2: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../shared/lib/thumbnail.js', () => ({
  generatePdfThumbnail: vi.fn().mockResolvedValue(null),
}))

const { deleteFromR2, downloadFromR2, getPresignedDownloadUrl, uploadToR2 } = await import('../../shared/lib/r2.js')
const { generatePdfThumbnail } = await import('../../shared/lib/thumbnail.js')
const service = await import('./service.js')

const folderIds: string[] = []
const fileIds: string[] = []

const userIds: string[] = []

/**
 * Omul care face toate operațiile de mai jos — spațiile per om (Wave 6) înseamnă că fiecare apel
 * primește `me`, deci testul are nevoie de un user real (`shared/testing/users.ts`). Izolarea
 * între oameni e în `access.test.ts`.
 */
const qa = await createTestUser('arhiva principal', userIds)
async function makeFolder(name: string, parentId?: string, me: SessionUser = qa) {
  // `!` — pattern identic modules/pricing/service.test.ts: INSERT...RETURNING nu poate
  // întoarce zero rânduri aici, dar semnătura serviciului (`const [row] = ...` din
  // service.ts, convenție în tot backend-ul) tipează rezultatul ca posibil undefined.
  const row = (await service.createFolder(me, name, parentId))!
  folderIds.push(row.id)
  return row
}

async function makeFile(
  input: Partial<Omit<Parameters<typeof service.createFileRecord>[1], 'me'>> = {},
  me: SessionUser = qa,
) {
  const row = (await service.createFileRecord(me, {
    name: 'test.txt',
    mimeType: 'text/plain',
    sizeBytes: 42,
    r2Key: `archive/qa-test-${crypto.randomUUID()}`,
    tags: [],
    ...input,
  }))!
  fileIds.push(row.id)
  return row
}

// Curățarea merge pe owner, nu pe lista de id-uri: spațiile create implicit (rădăcina fiecărui
// om, la prima atingere) nu sunt în `folderIds`, iar `archive_folders.owner_user_id` e `restrict`
// — un user rămas cu foldere ar bloca ștergerea rândului său.
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
  await cleanupTestUsers(userIds)
})

describe('folders', () => {
  it('listFolders reports correct fileCount/subfolderCount (regresie: bug subquery corelat Drizzle)', async () => {
    const parent = await makeFolder('QA Archive Parent')
    await makeFolder('QA Archive Child', parent.id)
    await makeFile({ folderId: parent.id })
    await makeFile({ folderId: parent.id })

    const roots = await service.listFolders(qa)
    const found = roots.find((f) => f.id === parent.id)
    expect(found?.subfolderCount).toBe(1)
    expect(found?.fileCount).toBe(2)
  })

  it('updateFolder respinge un folder devenit propriul lui părinte', async () => {
    const folder = await makeFolder('QA Archive Self Parent')
    await expect(service.updateFolder(qa, folder.id, { parentId: folder.id })).rejects.toThrow(
      service.ArchiveConflictError,
    )
  })

  it('updateFolder respinge mutarea unui folder sub propriul descendent (ciclu)', async () => {
    const parent = await makeFolder('QA Archive Cycle Parent')
    const child = await makeFolder('QA Archive Cycle Child', parent.id)

    await expect(service.updateFolder(qa, parent.id, { parentId: child.id })).rejects.toThrow(
      service.ArchiveConflictError,
    )
  })

  it('updateFolder permite o mutare validă (fără ciclu)', async () => {
    const a = await makeFolder('QA Archive Valid Move A')
    const b = await makeFolder('QA Archive Valid Move B')
    const moved = (await service.updateFolder(qa, a.id, { parentId: b.id }))!
    expect(moved.parentId).toBe(b.id)
  })

  it('updateFolder pe un folder deja șters (soft) dă 404, nu-l "resuscită"', async () => {
    const folder = await makeFolder('QA Archive Update Deleted')
    await service.deleteFolder(qa, folder.id)
    // Un folder șters e „inexistent" la fel ca unul din alt spațiu: `requireFolder` e singurul
    // loc care decide, și aruncă ArchiveNotFoundError → 404 pe rută.
    await expect(service.updateFolder(qa, folder.id, { name: 'nu ar trebui să meargă' })).rejects.toThrow(
      service.ArchiveNotFoundError,
    )
  })

  it('deleteFolder respinge ștergerea unui folder cu subfoldere', async () => {
    const parent = await makeFolder('QA Archive Delete Parent')
    await makeFolder('QA Archive Delete Child', parent.id)
    await expect(service.deleteFolder(qa, parent.id)).rejects.toThrow(service.ArchiveConflictError)
  })

  it('deleteFolder respinge ștergerea unui folder cu fișiere', async () => {
    const folder = await makeFolder('QA Archive Delete With Files')
    await makeFile({ folderId: folder.id })
    await expect(service.deleteFolder(qa, folder.id)).rejects.toThrow(service.ArchiveConflictError)
  })

  it('deleteFolder șterge (soft) un folder gol', async () => {
    const folder = await makeFolder('QA Archive Delete Empty')
    const deleted = (await service.deleteFolder(qa, folder.id))!
    expect(deleted.deletedAt).not.toBeNull()
  })
})

describe('files', () => {
  it('listFiles filtrează după q (ILIKE pe nume)', async () => {
    await makeFile({ name: 'Contract-Vanadium-2026.pdf' })
    await makeFile({ name: 'Poza-vacanta.jpg' })

    const results = await service.listFiles(qa, { q: 'contract', page: 1 })
    expect(results.some((f) => f.name === 'Contract-Vanadium-2026.pdf')).toBe(true)
    expect(results.every((f) => f.name.toLowerCase().includes('contract'))).toBe(true)
  })

  it('listFiles filtrează după tags (conține toate tag-urile cerute)', async () => {
    await makeFile({ name: 'QA-tagged-both.pdf', tags: ['facturi', 'urgent'] })
    await makeFile({ name: 'QA-tagged-one.pdf', tags: ['facturi'] })

    const results = await service.listFiles(qa, { tags: 'facturi,urgent', page: 1 })
    expect(results.some((f) => f.name === 'QA-tagged-both.pdf')).toBe(true)
    expect(results.some((f) => f.name === 'QA-tagged-one.pdf')).toBe(false)
  })

  it('listFiles filtrează după folderId', async () => {
    const folder = await makeFolder('QA Archive Files Folder')
    const inFolder = await makeFile({ folderId: folder.id, name: 'QA-in-folder.pdf' })
    await makeFile({ name: 'QA-outside-folder.pdf' })

    const results = await service.listFiles(qa, { folderId: folder.id, page: 1 })
    expect(results.map((f) => f.id)).toEqual([inFolder.id])
  })

  it('listFiles fără folderId (rădăcină) exclude fișierele din subfoldere (regresie: apăreau peste tot)', async () => {
    const folder = await makeFolder('QA Archive Root Regression Folder')
    const inFolder = await makeFile({ folderId: folder.id, name: 'QA-root-regression-in-folder.pdf' })
    const atRoot = await makeFile({ name: 'QA-root-regression-at-root.pdf' })

    const results = await service.listFiles(qa, { page: 1 })
    const ids = results.map((f) => f.id)
    expect(ids).toContain(atRoot.id)
    expect(ids).not.toContain(inFolder.id)
  })

  it('listFiles: previewUrl pt. imagini vine din propriul r2Key (fără thumbnail separat)', async () => {
    const image = await makeFile({ name: 'QA-preview-image.png', mimeType: 'image/png' })
    vi.mocked(getPresignedDownloadUrl).mockClear()

    const results = await service.listFiles(qa, { q: 'QA-preview-image', page: 1 })
    expect(results[0]?.previewUrl).toBe('https://r2.example.com/presigned-fake')
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith(image.r2Key)
  })

  it('listFiles: previewUrl pt. PDF cu thumbnailR2Key folosește thumbnail-ul, nu originalul', async () => {
    const pdf = await makeFile({
      name: 'QA-preview-pdf.pdf',
      mimeType: 'application/pdf',
      thumbnailR2Key: 'archive/thumbnails/qa-test-thumb.jpg',
    })
    vi.mocked(getPresignedDownloadUrl).mockClear()

    const results = await service.listFiles(qa, { q: 'QA-preview-pdf', page: 1 })
    expect(results[0]?.previewUrl).toBe('https://r2.example.com/presigned-fake')
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith(pdf.thumbnailR2Key)
    expect(getPresignedDownloadUrl).not.toHaveBeenCalledWith(pdf.r2Key)
  })

  it('listFiles: previewUrl e null pt. fișiere fără thumbnail și care nu sunt imagini', async () => {
    await makeFile({ name: 'QA-preview-none.xml', mimeType: 'application/xml' })
    const results = await service.listFiles(qa, { q: 'QA-preview-none', page: 1 })
    expect(results[0]?.previewUrl).toBeNull()
  })

  it('getFileForDownload dă 404 pt. un id inexistent, fără să apeleze R2', async () => {
    vi.mocked(getPresignedDownloadUrl).mockClear()
    await expect(service.getFileForDownload(qa, crypto.randomUUID())).rejects.toThrow(
      service.ArchiveNotFoundError,
    )
    expect(getPresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('getFileForDownload cere un URL presemnat pt. un fișier existent, cu dispoziție INLINE (2026-09-03 — e preview la click pe rând, nu descărcare reală; aia merge pe alt endpoint, cu attachment)', async () => {
    const file = await makeFile({ name: 'QA-download.pdf' })
    const result = await service.getFileForDownload(qa, file.id)
    expect(result?.url).toBe('https://r2.example.com/presigned-fake')
    // inline + numele din DB — altfel un click pe fișier îl deschidea în tab nou ȘI îl descărca
    // automat pe disc (bug real Stefan).
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith(
      file.r2Key,
      900,
      'inline; filename="QA-download.pdf"',
    )
  })

  it('getFileBufferForDownload întoarce null pt. un id inexistent, fără să apeleze R2 (2026-08-11)', async () => {
    vi.mocked(downloadFromR2).mockClear()
    const result = await service.getFileBufferForDownload(qa, crypto.randomUUID())
    expect(result).toBeNull()
    expect(downloadFromR2).not.toHaveBeenCalled()
  })

  it('getFileBufferForDownload streamuiește bytes-ii prin R2 (nu URL presemnat) pt. un fișier existent', async () => {
    const file = await makeFile({ name: 'QA-buffer-download.pdf', mimeType: 'application/pdf' })
    const result = await service.getFileBufferForDownload(qa, file.id)
    expect(result?.name).toBe('QA-buffer-download.pdf')
    expect(result?.mimeType).toBe('application/pdf')
    expect(result?.buffer.toString()).toBe('fake file bytes')
    expect(downloadFromR2).toHaveBeenCalledWith(file.r2Key)
  })

  it('updateFile pe un fișier deja șters (soft) dă 404, nu-l "resuscită"', async () => {
    const file = await makeFile({ name: 'QA-update-deleted.pdf' })
    await service.deleteFile(qa, file.id, false)
    await expect(service.updateFile(qa, file.id, { name: 'nu ar trebui să meargă' })).rejects.toThrow(
      service.ArchiveNotFoundError,
    )
  })

  it('deleteFile (soft) marchează deletedAt, NU apelează R2', async () => {
    const file = await makeFile({ name: 'QA-soft-delete.pdf' })
    vi.mocked(deleteFromR2).mockClear()
    const deleted = await service.deleteFile(qa, file.id, false)
    expect(deleted?.deletedAt).toBeNull() // rândul întors e cel citit ÎNAINTE de update
    expect(deleteFromR2).not.toHaveBeenCalled()

    const [row] = await db.select().from(archiveFiles).where(inArray(archiveFiles.id, [file.id]))
    expect(row?.deletedAt).not.toBeNull()
  })

  it('deleteFile (permanent) apelează deleteFromR2 și șterge rândul din DB', async () => {
    const file = await makeFile({ name: 'QA-permanent-delete.pdf' })
    fileIds.splice(fileIds.indexOf(file.id), 1) // șters explicit mai jos, nu mai există pt. afterAll

    await service.deleteFile(qa, file.id, true)
    expect(deleteFromR2).toHaveBeenCalledWith(file.r2Key)

    const rows = await db.select().from(archiveFiles).where(inArray(archiveFiles.id, [file.id]))
    expect(rows).toHaveLength(0)
  })

  it('deleteFile (permanent) pt. un PDF cu thumbnail șterge ambele obiecte din R2 (original + thumbnail)', async () => {
    const file = await makeFile({
      name: 'QA-permanent-delete-with-thumb.pdf',
      mimeType: 'application/pdf',
      thumbnailR2Key: 'archive/thumbnails/qa-test-delete-thumb.jpg',
    })
    fileIds.splice(fileIds.indexOf(file.id), 1)
    vi.mocked(deleteFromR2).mockClear()

    await service.deleteFile(qa, file.id, true)
    expect(deleteFromR2).toHaveBeenCalledWith(file.r2Key)
    expect(deleteFromR2).toHaveBeenCalledWith(file.thumbnailR2Key)
  })
})

describe('searchFiles', () => {
  it('caută pe toată arhiva, indiferent de folder, și întoarce path-ul complet', async () => {
    const parent = await makeFolder('QA Search Parent')
    const child = await makeFolder('QA Search Child', parent.id)
    const nested = await makeFile({ folderId: child.id, name: 'QA-search-nested-target.pdf' })
    const atRoot = await makeFile({ folderId: parent.id, name: 'QA-search-root-target.pdf' })

    const results = await service.searchFiles(qa, 'qa-search')
    const ids = results.map((r) => r.id)
    expect(ids).toContain(nested.id)
    expect(ids).toContain(atRoot.id)

    // Drumul pornește de la rădăcina spațiului omului (primul crumb), nu de la o rădăcină comună.
    const own = (await service.listSpaces(qa)).own!
    const nestedResult = results.find((r) => r.id === nested.id)
    expect(nestedResult?.folderPath.map((p) => p.id)).toEqual([own.id, parent.id, child.id])
  })

  it('include previewUrl în rezultate (imagine → propriul r2Key)', async () => {
    const image = await makeFile({ name: 'QA-search-preview-image.png', mimeType: 'image/png' })
    const results = await service.searchFiles(qa, 'qa-search-preview-image')
    expect(results[0]?.previewUrl).toBe('https://r2.example.com/presigned-fake')
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith(image.r2Key)
  })

  it('nu întoarce fișiere care nu se potrivesc cu q', async () => {
    await makeFile({ name: 'QA-search-nomatch.pdf' })
    const results = await service.searchFiles(qa, 'qa-search-string-fara-potrivire-xyz')
    expect(results).toHaveLength(0)
  })
})

describe('monthly auto-folders (jobs/archive-monthly-folders.ts)', () => {
  it('listAutoMonthlyFolders întoarce doar folderele cu flag-ul activ', async () => {
    const marked = (await service.createFolder(qa, 'QA Auto Monthly Marked'))!
    await service.updateFolder(qa, marked.id, { autoMonthlySubfolders: true })
    await makeFolder('QA Auto Monthly Unmarked')
    folderIds.push(marked.id)

    const results = await service.listAutoMonthlyFolders()
    const ids = results.map((f) => f.id)
    expect(ids).toContain(marked.id)
  })

  it('ensureFolder creează subfolderul o singură dată (idempotent)', async () => {
    const parent = await makeFolder('QA Ensure Monthly Parent')
    const firstId = await service.ensureFolder('07-2026', parent.id)
    const secondId = await service.ensureFolder('07-2026', parent.id)
    expect(secondId).toBe(firstId)

    const subfolders = await service.listFolders(qa, parent.id)
    expect(subfolders).toHaveLength(1)
    folderIds.push(firstId)
  })

  it('monthYearFolderName formatează "LL-AAAA" cu lună paded pe 2 cifre', () => {
    expect(service.monthYearFolderName(new Date('2026-01-15T00:00:00Z'))).toBe('01-2026')
    expect(service.monthYearFolderName(new Date('2026-11-30T23:59:00Z'))).toBe('11-2026')
  })
})

describe('ensureFolderPath', () => {
  it('creează lanțul complet de foldere și reutilizează segmentele existente', async () => {
    const rootName = `QA Ensure Path Root ${crypto.randomUUID()}`
    // Rădăcina e explicită de la caller (joburile scriu în spațiul ales de om), deci testul
    // își face propria rădăcină de test în locul spațiului principal.
    const root = await makeFolder(rootName)
    const leafId = await service.ensureFolderPath(root.id, ['07-2026', 'Facturi furnizori', 'Hetzner'])

    const level2 = await service.listFolders(qa, root.id)
    folderIds.push(level2[0]!.id)
    const level3 = await service.listFolders(qa, level2[0]!.id)
    folderIds.push(level3[0]!.id)
    const level4 = await service.listFolders(qa, level3[0]!.id)
    expect(level4[0]?.id).toBe(leafId)
    folderIds.push(leafId)

    // A doua chemare cu același path nu duplică niciun segment.
    const leafIdAgain = await service.ensureFolderPath(root.id, ['07-2026', 'Facturi furnizori', 'Hetzner'])
    expect(leafIdAgain).toBe(leafId)
    const level2Again = await service.listFolders(qa, root.id)
    expect(level2Again).toHaveLength(1)
  })
})

describe('getFolderPath (2026-09-03 — reconstrucția breadcrumb-ului din URL, ArchivePage.tsx)', () => {
  it('întoarce lanțul de strămoși rădăcină → folder curent, inclusiv, în ordine', async () => {
    const own = (await service.listSpaces(qa)).own!
    const root = await makeFolder(`QA Path Root ${crypto.randomUUID()}`)
    const child = await makeFolder('QA Path Child', root.id)
    const grandchild = await makeFolder('QA Path Grandchild', child.id)

    const { path, level, canShare } = await service.getFolderPath(qa, grandchild.id)
    expect(level).toBe('edit')
    expect(canShare).toBe(true)
    expect(path.map((p) => p.id)).toEqual([own.id, root.id, child.id, grandchild.id])
    expect(path.map((p) => p.name)).toEqual([own.name, root.name, 'QA Path Child', 'QA Path Grandchild'])
  })

  it('rădăcina spațiului întoarce doar ea însăși', async () => {
    const own = (await service.listSpaces(qa)).own!
    const { path } = await service.getFolderPath(qa, own.id)
    expect(path).toEqual([{ id: own.id, name: own.name }])
  })

  it('dă 404 pt. un id inexistent (folder șters între timp)', async () => {
    await expect(service.getFolderPath(qa, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      service.ArchiveNotFoundError,
    )
  })
})

describe('uploadFile', () => {
  it('urcă buffer-ul în R2 și creează rândul, cu sizeBytes calculat din buffer', async () => {
    const buffer = Buffer.from('conținut test upload')
    const row = (await service.uploadFile(qa, { name: 'QA-upload-buffer.txt', mimeType: 'text/plain', buffer }))!
    fileIds.push(row.id)

    expect(uploadToR2).toHaveBeenCalledWith(expect.stringContaining('QA-upload-buffer.txt'), expect.anything(), 'text/plain')
    expect(row.sizeBytes).toBe(buffer.byteLength)
    expect(row.thumbnailR2Key).toBeNull()
  })

  it('pt. PDF, generează thumbnail best-effort și îl leagă de rândul creat', async () => {
    vi.mocked(generatePdfThumbnail).mockResolvedValueOnce(Buffer.from('fake-jpeg-bytes'))
    const buffer = Buffer.from('%PDF-fake-content')
    const row = (await service.uploadFile(qa, { name: 'QA-upload-pdf.pdf', mimeType: 'application/pdf', buffer }))!
    fileIds.push(row.id)

    expect(row.thumbnailR2Key).toMatch(/^archive\/thumbnails\//)
  })
})

describe('findFileByName', () => {
  it('găsește un fișier existent după nume exact, în folderul dat', async () => {
    const folder = await makeFolder('QA Find By Name Folder')
    const file = await makeFile({ folderId: folder.id, name: 'QA-find-by-name.pdf' })

    const found = await service.findFileByName(folder.id, 'QA-find-by-name.pdf')
    expect(found?.id).toBe(file.id)

    const notFound = await service.findFileByName(folder.id, 'nu-exista.pdf')
    expect(notFound).toBeUndefined()
  })
})

describe('getStorageUsage (avertisment plafon R2)', () => {
  it('crește usedBytes exact cu sizeBytes al fișierelor active nou create', async () => {
    const before = await service.getStorageUsage(qa)
    await makeFile({ sizeBytes: 12_345 })
    await makeFile({ sizeBytes: 7_655 })
    const after = await service.getStorageUsage(qa)
    expect(after.usedBytes).toBe(before.usedBytes + 20_000)
    expect(after.limitBytes).toBe(before.limitBytes)
    expect(after.limitBytes).toBeGreaterThan(0)
  })

  it('nu numără fișierele soft-șterse', async () => {
    const file = await makeFile({ sizeBytes: 999_999 })
    const before = await service.getStorageUsage(qa)
    await service.deleteFile(qa, file.id, false)
    const after = await service.getStorageUsage(qa)
    expect(after.usedBytes).toBe(before.usedBytes - 999_999)
  })
})
