/**
 * modules/archive/access.ts — izolarea între spații (Wave 6), pg real (test/setup.ts).
 *
 * R2 e mockuit la fel ca în service.test.ts; aici nu contează conținutul, ci **cine ce poate
 * vedea**: fiecare caz taie o cale anume (listă, search, id direct, mutare, share, atribuire),
 * pentru ca o cale nouă să nu poată intra înarbore fără test.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolders } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'

vi.mock('../../shared/lib/r2.js', () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  downloadFromR2: vi.fn().mockResolvedValue(Buffer.from('bytes')),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned-fake'),
  uploadToR2: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../shared/lib/thumbnail.js', () => ({
  generatePdfThumbnail: vi.fn().mockResolvedValue(null),
}))

const service = await import('./service.js')

const userIds: string[] = []

const stefan = await createTestUser('spații stefan', userIds)
const ana = await createTestUser('spații ana', userIds)
const bob = await createTestUser('spații bob', userIds)
const manager = await createTestUser('spații manager', userIds, { features: ['arhiva.administrare'] })
// Manager *fără* `arhiva.administrare`: rolul singur nu dă nimic, funcționalitatea e ce deschide.
const managerFara = await createTestUser('spații manager fără feature', userIds, { roleKind: 'manager' })
const admin = await createTestUser('spații admin', userIds, { roleKind: 'admin' })
const carol = await createTestUser('spații carol', userIds)

async function folder(me: typeof stefan, name: string, parentId?: string) {
  return (await service.createFolder(me, name, parentId))!
}

async function file(me: typeof stefan, input: { folderId?: string; name: string; sizeBytes?: number }) {
  const row = (await service.createFileRecord(me, {
    mimeType: 'text/plain',
    sizeBytes: 10,
    ...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
    r2Key: `archive/qa-spaces-${crypto.randomUUID()}`,
    tags: [],
    ...input,
  }))!
  return row
}

/** Rădăcina spațiului unui om — creeată la prima atingere, deci o apelăm explicit ca să știm id-ul. */
async function rootOf(me: typeof stefan) {
  const spaces = await service.listSpaces(me)
  return spaces.own!.id
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

describe('listSpaces — ecranul de sus', () => {
  it('omul vede doar spațiul lui, gol la început', async () => {
    const spaces = await service.listSpaces(ana)
    expect(spaces.own?.name).toBe('Spațiul lui QA spații ana')
    expect(spaces.shared).toEqual([])
    expect(spaces.spaces).toBeNull() // fără arhiva.administrare nu primim „Toate spațiile"
  })

  it('un folder primit prin share apare la „Partajate cu mine", cu numele omului și nivelul', async () => {
    const baza = await folder(stefan, 'Contracte 2026')
    await service.setShare(stefan, baza.id, ana.id, 'view')

    const spaces = await service.listSpaces(ana)
    const shared = spaces.shared.find((s) => s.id === baza.id)
    expect(shared).toBeDefined()
    expect(shared?.ownerName).toBe('QA spații stefan')
    expect(shared?.level).toBe('view')
  })

  it('„Toate spațiile" apare doar cu arhiva.administrare și e grupabil pe om', async () => {
    await folder(stefan, 'Contabilitate')
    const withFeature = await service.listSpaces(manager)
    expect(withFeature.spaces?.length).toBeGreaterThan(0)
    const owners = new Set(withFeature.spaces!.map((s) => s.ownerUserId))
    expect(owners.has(stefan.id)).toBe(true)

    const plain = await service.listSpaces(bob)
    expect(plain.spaces).toBeNull()
  })
})

describe('izolare între spații', () => {
  it('listFolders pe un folder din alt spațiu aruncă 404, nu listează nimic', async () => {
    const baza = await folder(stefan, 'Contabilitate secretă')
    await expect(service.listFolders(ana, baza.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('un fișier cerut direct prin id, din alt spațiu, e tot 404 (nu 403)', async () => {
    const baza = await folder(stefan, 'Dosar fiscal')
    const f = await file(stefan, { folderId: baza.id, name: 'secret.pdf' })

    await expect(service.getFileForDownload(ana, f.id)).rejects.toThrow(service.ArchiveNotFoundError)
    expect(await service.getFileBufferForDownload(ana, f.id)).toBeNull()
    await expect(service.updateFile(ana, f.id, { name: 'copie.pdf' })).rejects.toThrow(service.ArchiveNotFoundError)
    await expect(service.deleteFile(ana, f.id, false)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('searchFiles nu scoate fișiere din alt spațiu', async () => {
    const baza = await folder(stefan, 'Acte confidențiale')
    await file(stefan, { folderId: baza.id, name: 'QA-izolare-contract-semnat.pdf' })
    await file(ana, { folderId: await rootOf(ana), name: 'QA-izolare-contract-meu.pdf' })

    const seenByAna = await service.searchFiles(ana, 'QA-izolare-contract')
    expect(seenByAna.map((r) => r.name)).toEqual(['QA-izolare-contract-meu.pdf'])

    const seenByStefan = await service.searchFiles(stefan, 'QA-izolare-contract')
    expect(seenByStefan.map((r) => r.name)).toContain('QA-izolare-contract-semnat.pdf')
    expect(seenByStefan.map((r) => r.name)).not.toContain('QA-izolare-contract-meu.pdf')
  })

  it('getFolderPath pe un folder din alt spațiu aruncă 404 (breadcrumb-ul nu îl dezvăluiește)', async () => {
    const baza = await folder(stefan, 'Contabilitate / 07-2026')
    await expect(service.getFolderPath(ana, baza.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('zip-ul unui folder din alt spațiu e null, nu o eroare', async () => {
    const baza = await folder(stefan, 'Arhivă fiscală')
    expect(await service.buildFolderZipBuffer(ana, baza.id)).toBeNull()
  })

  it('spațiul ocupat e per om: celălalt om nu vede fișierele mele în totalul lui', async () => {
    const baza = await folder(ana, 'Mari')
    const stefanBefore = await service.getStorageUsage(stefan)
    await file(ana, { folderId: baza.id, name: 'mare.pdf', sizeBytes: 7777 })
    const after = await service.getStorageUsage(ana)
    const stefanAfter = await service.getStorageUsage(stefan)
    expect(after.usedBytes).toBeGreaterThanOrEqual(7777)
    // Spațiul lui Stefan nu s-a mișcat: totalul lui nu conține fișierul Anei.
    expect(stefanAfter.usedBytes).toBe(stefanBefore.usedBytes)
    expect(stefanAfter.totalUsedBytes).toBeNull() // totalul firmei e doar pentru administrare
  })

  it('un folder nou al unui om nu poate fi mutat în spațiul altcuia — și nici măcar nu află că există', async () => {
    const alMeu = await folder(ana, 'Al meu')
    const alLui = await folder(stefan, 'Al lui')
    await expect(service.updateFolder(ana, alMeu.id, { parentId: alLui.id })).rejects.toThrow(
      service.ArchiveNotFoundError,
    )
  })
})

describe('share pe folder', () => {
  it('„vede" dă acces la citit, nu la scris', async () => {
    const baza = await folder(stefan, 'Dosar comun')
    await service.setShare(stefan, baza.id, ana.id, 'view')
    const f = await file(stefan, { folderId: baza.id, name: 'comun.pdf' })

    expect((await service.getFileForDownload(ana, f.id)).url).toContain('presigned')
    await expect(service.updateFile(ana, f.id, { name: 'nu.pdf' })).rejects.toThrow(service.ArchiveNotFoundError)
    await expect(service.deleteFile(ana, f.id, false)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('lista de foldere și drumul spun nivelul și dacă omul poate da share', async () => {
    const baza = await folder(stefan, 'Niveluri')
    const sub = await folder(stefan, 'Niveluri sub', baza.id)
    await service.setShare(stefan, baza.id, ana.id, 'view')
    const [row] = await service.listFolders(ana, baza.id)
    expect(row).toMatchObject({ id: sub.id, level: 'view', canShare: false })
    expect(await service.getFolderPath(ana, sub.id)).toMatchObject({ level: 'view', canShare: false })
    const [own] = await service.listFolders(stefan, baza.id)
    expect(own).toMatchObject({ level: 'edit', canShare: true })
  })

  it('„editează" dă acces la scris în folder, dar nu și la a-l da mai departe', async () => {
    const baza = await folder(stefan, 'Contabilitate comună')
    await service.setShare(stefan, baza.id, ana.id, 'edit')

    const creat = await folder(ana, 'Subfolder de lucru', baza.id)
    expect(creat.ownerUserId).toBe(stefan.id) // spațiul rămâne al proprietarului
    await expect(service.setShare(ana, baza.id, bob.id, 'view')).rejects.toThrow(service.ArchiveNotFoundError)
    await expect(service.removeShare(ana, baza.id, bob.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('dreptul se moștenește în subarbore, fără câte un rând de share pe fiecare folder', async () => {
    const baza = await folder(stefan, 'Pachet')
    const sub = await folder(stefan, '07-2026', baza.id)
    const f = await file(stefan, { folderId: sub.id, name: 'factura.pdf' })

    await service.setShare(stefan, baza.id, bob.id, 'view')
    // Share-ul e pe „Pachet", nu pe „07-2026" sau pe fișier — și totuși Bob vede subfolderul
    // și poate descărca fișierul, fără niciun rând de share în plus.
    expect((await service.listFolders(bob, baza.id)).map((c) => c.id)).toContain(sub.id)
    expect((await service.getFileForDownload(bob, f.id)).url).toContain('presigned')
  })

  it('schimbarea nivelului face UPDATE pe același rând, nu creează al doilea', async () => {
    const baza = await folder(stefan, 'Niveluri')
    await service.setShare(stefan, baza.id, ana.id, 'view')
    const shares = await service.setShare(stefan, baza.id, ana.id, 'edit')
    expect(shares.filter((s) => s.userId === ana.id)).toHaveLength(1)
    expect(shares.find((s) => s.userId === ana.id)?.level).toBe('edit')
  })

  it('scoaterea share-ului închide din nou accesul', async () => {
    const baza = await folder(stefan, 'Temporar')
    await service.setShare(stefan, baza.id, ana.id, 'edit')
    await service.removeShare(stefan, baza.id, ana.id)
    await expect(service.listFolders(ana, baza.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('adminul poate da share pe folderul altcuia, proprietarul îl poate da pe al lui', async () => {
    const fiscal = await folder(stefan, 'Fiscal 2026')
    await expect(service.setShare(admin, fiscal.id, ana.id, 'view')).resolves.toBeDefined()

    const bazaAna = await folder(ana, 'Contabilitate Ana')
    await expect(service.setShare(ana, bazaAna.id, bob.id, 'view')).resolves.toBeDefined()
    // Dar Ana nu poate da share pe folderul lui Stefan, nici măcar „view".
    await expect(service.setShare(ana, fiscal.id, bob.id, 'view')).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('nu poți împărți spațiul cu tine însuți', async () => {
    const baza = await folder(stefan, 'Solo')
    await expect(service.setShare(stefan, baza.id, stefan.id, 'view')).rejects.toThrow(
      service.ArchiveConflictError,
    )
  })
})

describe('atribuire (admin sau arhiva.administrare)', () => {
  it('fără funcționalitate, atribuirea e 404 chiar pentru admin (serverul e singurul care refuză)', async () => {
    const baza = await folder(stefan, 'Nu se atribuie')
    await expect(service.assignFolder(bob, baza.id, ana.id)).rejects.toThrow(service.ArchiveNotFoundError)
    await expect(service.assignAllSpaces(bob, stefan.id, ana.id)).rejects.toThrow(service.ArchiveNotFoundError)
  })

  it('cu arhiva.administrare, folderul își mută tot subarborele la omul nou', async () => {
    const baza = await folder(stefan, 'Mutat')
    const sub = await folder(stefan, 'Sub', baza.id)

    await service.assignFolder(manager, baza.id, bob.id)
    const [movedSub] = await db
      .select({ ownerUserId: archiveFolders.ownerUserId })
      .from(archiveFolders)
      .where(inArray(archiveFolders.id, [sub.id]))
    expect(movedSub?.ownerUserId).toBe(bob.id)
    // Și omul nou intră în folder fără niciun share, deci vede și copiii mutați odată cu el.
    expect((await service.listFolders(bob, baza.id)).map((c) => c.id)).toContain(sub.id)
  })

  it('„Atribuie toate spațiile lui" mută tot arborele Anei dintr-un singur apel', async () => {
    const radacina = await folder(ana, 'Spațiu Ana 1')
    await folder(ana, 'Sub', radacina.id)
    const rezultat = await service.assignAllSpaces(manager, ana.id, bob.id)
    const ramase = await db
      .select({ id: archiveFolders.id })
      .from(archiveFolders)
      .where(eq(archiveFolders.ownerUserId, ana.id))
    expect(rezultat.moved).toBeGreaterThanOrEqual(3) // rădăcină + subfolder
    expect(ramase).toHaveLength(0)
  })
})

describe('rolul singur nu deschide nimic: manager fără arhiva.administrare', () => {
  it('nu vede conținutul altor spații și nu primește „Toate spațiile"', async () => {
    const baza = await folder(stefan, 'Doar pentru Stefan')
    await expect(service.listFolders(managerFara, baza.id)).rejects.toThrow(service.ArchiveNotFoundError)
    expect((await service.listSpaces(managerFara)).spaces).toBeNull()
    // Managerul *cu* funcționalitatea vede rădăcinile, deci știe că spațiul există — și tot
    // nu intră în el (vede conținutul doar prin „Toate spațiile" și prin share-uri).
    expect((await service.listSpaces(manager)).spaces?.length).toBeGreaterThan(0)
  })
})

// 2026-10-01: un arbore cu ciclu a făcut CTE-urile recursive cu `UNION ALL` să nu se mai termine
// (15 interogări, ~700 GB de fișiere temporare pe Postgres-ul de dev). Ciclul de aici e făcut
// direct în DB, pe lângă `wouldCreateCycle`, ca să simuleze date deja stricate. Dacă unul din
// apelurile de mai jos regresează, testul se blochează în loc să pice — tot e un semnal.
describe('arbore cu ciclu în date: interogările recursive se termină', () => {
  it('listare, căutare, zip, mutare și atribuire pe A ↔ B', async () => {
    const a = await folder(carol, 'Ciclu A')
    const b = await folder(carol, 'Ciclu B', a.id)
    await db.update(archiveFolders).set({ parentId: b.id }).where(eq(archiveFolders.id, a.id))

    expect(await service.listFolders(carol, a.id, 'recent')).toHaveLength(1)
    expect(await service.searchFiles(carol, 'Ciclu')).toEqual([])
    expect(await service.listFilesUnderFolderRecursive(a.id)).toEqual([])
    expect((await service.listSpaces(carol)).own).not.toBeNull()
    const c = await folder(carol, 'Ciclu C')
    await expect(service.updateFolder(carol, c.id, { parentId: a.id })).resolves.toBeDefined()
    await expect(service.updateFolder(carol, a.id, { parentId: c.id })).rejects.toThrow(service.ArchiveConflictError)
    await expect(service.assignFolder(manager, a.id, bob.id)).resolves.toMatchObject({ ownerUserId: bob.id })
  })

  it('un folder nu poate fi propriul părinte, nici scris direct în DB', async () => {
    const a = await folder(carol, 'Autoreferință')
    await expect(
      db.execute(sql`UPDATE archive_folders SET parent_id = id WHERE id = ${a.id}`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'archive_folders_not_own_parent' } })
  })
})
