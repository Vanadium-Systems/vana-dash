import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { and, asc, desc, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { config } from '../../shared/config.js'
import { assertStorageAvailable, StorageFullError } from '../../shared/lib/storage-quota.js'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolderShares, archiveFolders, archiveStars, users } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { downloadFromR2, getPresignedDownloadUrl, uploadToR2 } from '../../shared/lib/r2.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { generatePdfThumbnail } from '../../shared/lib/thumbnail.js'
import {
  EDIT_ACCESS,
  VIEW_ACCESS,
  accessibleFoldersCte,
  accessiblePathsCte,
  ensureSpaceRoot,
  ensureSpaceRow,
  folderAccessLevel,
  listAllSpaceRoots,
  listFolderShares,
  managesAllSpaces,
  systemArchiveRoot,
} from './access.js'
import { tr } from '../../shared/lib/i18n.js'
import { foldedIlike } from '../../shared/lib/text.js'
import type { FileType } from './schema.js'

// Joburile de arhivare (shared/lib/financial-archive.ts, archive-export.ts) importă doar
// service-ul arhivei, nu fișierul cu CTE-ul de acces — de aici re-exportul.
export { systemArchiveRoot }

export class ArchiveConflictError extends Error {}

// Lives in shared/lib/storage-quota.ts (voice notes count against the same bucket).
export { StorageFullError as ArchiveStorageFullError, assertStorageAvailable }

/**
 * Cerere pe un folder din alt spațiu. Răspunsul e 404, nu 403 — la fel ca atașamentele din
 * Mesaje: cine nu are acces n-are de ce să afle că folderul există.
 */
export class ArchiveNotFoundError extends Error {
  /** The item a bulk request failed on, so the client can point at it. */
  readonly itemId?: string
  constructor(itemId?: string, message?: string) {
    super(message ?? tr('errors.archive.folderNotFound'))
    this.itemId = itemId
  }
}

async function assertAccess(me: SessionUser, folderId: string, min: 1 | 2): Promise<void> {
  const level = await folderAccessLevel(me, folderId)
  if (level < min) throw new ArchiveNotFoundError()
}

export async function wouldCreateCycle(folderId: string, candidateParentId: string): Promise<boolean> {
  // Urcă din candidateParentId spre rădăcină; dacă întâlnește folderId pe drum,
  // folderId ar deveni propriul lui strămoș — ciclu invalid.
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM archive_folders WHERE id = ${candidateParentId}
      UNION
      SELECT f.id, f.parent_id FROM archive_folders f JOIN ancestors a ON f.id = a.parent_id
    )
    SELECT id FROM ancestors WHERE id = ${folderId} LIMIT 1
  `)
  return rows.length > 0
}

/**
 * Proprietarul cu care se creează un folder: al părintelui (spațiul se propagă în subarbore).
 * La rădăcină — spațiul omului, creat la nevoie.
 */
export async function createFolder(me: SessionUser, name: string, parentId?: string) {
  // Fără `parentId` folderul se creează **în** spațiul omului, nu ca rădăcină nouă: o rădăcină
  // e un spațiu, iar spațiul unui om se creează o singură dată (`ensureSpaceRow`). La rădăcină
  // proprietarul e omul, nu folderul — `ensureSpaceRoot` întoarce id-ul folderului, deci
  // owner-ul vine din rândul lui (ambele sunt uuid-uri, deci un amestec al celor două ar trece
  // de FK doar dacă ar exista un user cu id-ul folderului).
  const parent = parentId ? await requireFolder(me, parentId, EDIT_ACCESS) : await ensureSpaceRow(me)
  const [row] = await db
    .insert(archiveFolders)
    .values({ name, parentId: parent.id, ownerUserId: parent.ownerUserId })
    .returning()
  return row
}

const FOLDER_SORT_ORDER = {
  oldest: asc(archiveFolders.createdAt),
  name: asc(archiveFolders.name),
}

// Ordinea id-urilor la sortarea "recent" — nu doar createdAt-ul folderului însuși, ci cea mai
// recentă activitate din TOT subarborele lui (fișier adăugat/redenumit/mutat oricât de adânc,
// subfolder nou etc.) — cerință explicită Stefan: dacă pui ceva în Conta/Iulie/Facturi, Conta
// și Iulie ar trebui să urce la rândul lor, nu doar Facturi. CTE recursiv (același pattern ca
// wouldCreateCycle/searchFiles), calculat la citire — nicio propagare de update la scriere, deci
// mutările/ștergerile de fișiere/foldere se reflectă corect fără cod suplimentar la fiecare
// mutație.
async function recentFolderOrder(parentId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, id AS root_id, GREATEST(created_at, updated_at) AS ts
      FROM archive_folders
      WHERE parent_id = ${parentId} AND deleted_at IS NULL
      UNION
      SELECT f.id, s.root_id, GREATEST(f.created_at, f.updated_at) AS ts
      FROM archive_folders f
      JOIN subtree s ON f.parent_id = s.id
      WHERE f.deleted_at IS NULL
    )
    SELECT s.root_id AS id
    FROM subtree s
    LEFT JOIN archive_files af ON af.folder_id = s.id AND af.deleted_at IS NULL
    GROUP BY s.root_id
    ORDER BY GREATEST(MAX(s.ts), MAX(GREATEST(af.created_at, af.updated_at))) DESC
  `)
  return rows.map((r) => r.id)
}

export interface ArchiveFolderRow {
  id: string
  name: string
  parentId: string | null
  createdAt: Date
  autoMonthlySubfolders: boolean
  ownerUserId: string
  color: number | null
  starred: boolean
  fileCount: number
  subfolderCount: number
  itemCount: number
  /** Nivelul omului pe folder — UI-ul ascunde scrierea pe „vede". */
  level: 'view' | 'edit'
  /** Proprietarul sau adminul: doar ei văd „Partajează". */
  canShare: boolean
}

/**
 * Subfolderele unui folder. Fără `parentId` se listează rădăcina spațiului omului — pagina
 * pornește de acolo, nu de o rădăcină comună care nu mai există.
 */
export async function listFolders(
  me: SessionUser,
  parentId?: string,
  sort: 'recent' | 'oldest' | 'name' = 'name',
): Promise<ArchiveFolderRow[]> {
  const currentId = parentId ?? (await ensureSpaceRoot(me))
  await assertAccess(me, currentId, VIEW_ACCESS)
  const baseQuery = db
    .select({
      id: archiveFolders.id,
      name: archiveFolders.name,
      parentId: archiveFolders.parentId,
      createdAt: archiveFolders.createdAt,
      autoMonthlySubfolders: archiveFolders.autoMonthlySubfolders,
      ownerUserId: archiveFolders.ownerUserId,
      color: archiveFolders.color,
    })
    .from(archiveFolders)
    .where(and(sql`${archiveFolders.deletedAt} IS NULL`, sql`${archiveFolders.parentId} = ${currentId}`))

  let folders = await (sort === 'recent' ? baseQuery : baseQuery.orderBy(FOLDER_SORT_ORDER[sort]))

  if (sort === 'recent') {
    const order = await recentFolderOrder(currentId)
    const rank = new Map(order.map((id, i) => [id, i]))
    folders = [...folders].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  }

  if (folders.length === 0) return []

  // COUNT+GROUP BY separate (aggregation în SQL, regula #9) în loc de subquery corelat —
  // Drizzle nu califică `${archiveFolders.id}` cu numele tabelei în interiorul unui `sql`
  // template imbricat într-un alt SELECT pe același tabel, ceea ce lega greșit coloana de
  // alias-ul DIN subquery, nu de rândul exterior (bug confirmat empiric — fileCount/
  // subfolderCount ieșeau mereu 0 indiferent de conținutul real).
  const ids = folders.map((f) => f.id)
  const [fileCounts, subfolderCounts, levels, stars] = await Promise.all([
    db
      .select({ folderId: archiveFiles.folderId, count: sql<number>`COUNT(*)::int` })
      .from(archiveFiles)
      .where(and(sql`${archiveFiles.deletedAt} IS NULL`, inArray(archiveFiles.folderId, ids)))
      .groupBy(archiveFiles.folderId),
    db
      .select({ parentId: archiveFolders.parentId, count: sql<number>`COUNT(*)::int` })
      .from(archiveFolders)
      .where(and(sql`${archiveFolders.deletedAt} IS NULL`, inArray(archiveFolders.parentId, ids)))
      .groupBy(archiveFolders.parentId),
    db.execute<{ id: string; lvl: number }>(sql`
      ${accessibleFoldersCte(me)}
      SELECT id, lvl FROM access WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    `),
    db
      .select({ itemId: archiveStars.itemId })
      .from(archiveStars)
      .where(and(eq(archiveStars.userId, me.id), eq(archiveStars.itemType, 'folder'), inArray(archiveStars.itemId, ids))),
  ])
  const starredIds = new Set(stars.map((r) => r.itemId))
  const levelByFolder = new Map(levels.map((r) => [r.id, r.lvl]))
  const fileCountByFolder = new Map(fileCounts.map((r) => [r.folderId, r.count]))
  const subfolderCountByParent = new Map(subfolderCounts.map((r) => [r.parentId, r.count]))

  return folders.map((f) => {
    const fileCount = fileCountByFolder.get(f.id) ?? 0
    const subfolderCount = subfolderCountByParent.get(f.id) ?? 0
    return {
      ...f,
      starred: starredIds.has(f.id),
      fileCount,
      subfolderCount,
      itemCount: fileCount + subfolderCount,
        level: (levelByFolder.get(f.id) ?? 0) >= EDIT_ACCESS ? ('edit' as const) : ('view' as const),
      canShare: canShareFolder(me, f.ownerUserId),
    }
  })
}

export async function updateFolder(
  me: SessionUser,
  id: string,
  input: { name?: string; parentId?: string | null; autoMonthlySubfolders?: boolean; color?: number | null },
) {
  const folder = await requireFolder(me, id, EDIT_ACCESS)
  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === id) throw new ArchiveConflictError(tr('errors.archive.folderOwnParent'))
    if (await wouldCreateCycle(id, input.parentId)) {
      throw new ArchiveConflictError(tr('errors.archive.moveCycle'))
    }
    // Mutarea e permisă doar într-un folder unde omul are drept de editare: altfel ar muta
    // conținut într-un spațiu în care nu-l poate atinge nici apoi.
    await assertAccess(me, input.parentId, EDIT_ACCESS)
    // Moving a folder takes it out of its parent, so it needs the right there too (as deleting
    // does): a share on the folder itself is for working inside it.
    if (folder.parentId && folder.parentId !== input.parentId) await assertAccess(me, folder.parentId, EDIT_ACCESS)
  }
  // Mutarea în afara spațiului deținut de altcineva ar decupla subarborele de rădăcina lui;
  // owner_user_id rămâne al celui care mută, deci mutarea e interzisă (owner-ul se schimbă
  // doar prin atribuire explicită, din Echipă).
  const patch: Partial<typeof archiveFolders.$inferInsert> = { ...input, updatedAt: new Date() }
  if (input.parentId) {
    const target = await requireFolder(me, input.parentId, EDIT_ACCESS)
    if (target.ownerUserId !== folder.ownerUserId) {
      throw new ArchiveConflictError(tr('errors.archive.moveToOtherSpace'))
    }
  }
  const [row] = await db
    .update(archiveFolders)
    .set(patch)
    .where(and(eq(archiveFolders.id, id), sql`${archiveFolders.deletedAt} IS NULL`))
    .returning()
  return row ? { ...row, previousName: folder.name, previousParentId: folder.parentId } : row
}

/** Folderul, cu verificarea de acces făcută într-un singur loc — 404 dacă nu-l are. */
export async function requireFolder(me: SessionUser, folderId: string, min: 1 | 2) {
  const [folder] = await db
    .select({
      id: archiveFolders.id,
      name: archiveFolders.name,
      parentId: archiveFolders.parentId,
      ownerUserId: archiveFolders.ownerUserId,
    })
    .from(archiveFolders)
    .where(and(eq(archiveFolders.id, folderId), sql`${archiveFolders.deletedAt} IS NULL`))
  if (!folder) throw new ArchiveNotFoundError()
  if ((await folderAccessLevel(me, folderId)) < min) throw new ArchiveNotFoundError()
  return folder
}

export async function createFileRecord(
  me: SessionUser,
  input: {
    folderId?: string
    name: string
    mimeType: string
    sizeBytes: number
    r2Key: string
    thumbnailR2Key?: string
    tags: string[]
  },
) {
  // Fără folderId explicit (share target din APK) intră în rădăcina spațiului omului — altfel
  // fișierul n-ar aparține nimănui și n-ar fi vizibil pentru nimeni.
  const folderId = input.folderId ?? (await ensureSpaceRoot(me))
  await assertAccess(me, folderId, EDIT_ACCESS)
  const [row] = await db.insert(archiveFiles).values({ ...input, folderId }).returning()
  return row
}

// Imaginile își arată propriul obiect R2 direct (browserul îl scalează) — fără thumbnail
// separat. PDF-urile folosesc thumbnailR2Key (generat la upload, shared/lib/thumbnail.ts),
// dacă există. Restul tipurilor (xml, zip etc.) rămân fără preview — frontend cade pe iconiță.
// getPresignedDownloadUrl semnează local (SigV4), fără request către R2 — sigur de apelat per rând.
async function computePreviewUrl(file: { mimeType: string; r2Key: string; thumbnailR2Key: string | null }) {
  if (file.mimeType.startsWith('image/')) return getPresignedDownloadUrl(file.r2Key)
  if (file.thumbnailR2Key) return getPresignedDownloadUrl(file.thumbnailR2Key)
  return null
}

async function withPreviewUrl<T extends { mimeType: string; r2Key: string; thumbnailR2Key: string | null }>(
  rows: T[],
): Promise<(T & { previewUrl: string | null })[]> {
  return Promise.all(rows.map(async (row) => ({ ...row, previewUrl: await computePreviewUrl(row) })))
}

function parseTagsFilter(tags?: string) {
  return tags
    ? tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : []
}

// ${tagList} simplu ar trimite array-ul JS ca parametri separați ($1, $2, ...), pe care
// Postgres îi citește ca literal de tip `record` (paranteze), nu `text[]` — eroare
// "operator does not exist: text[] @> record" (găsit de un test QA, nu teoretic).
// ARRAY[...] construit explicit cu sql.join, fiecare element bind-uit separat + cast.
function tagsContainSql(tagList: string[]) {
  return sql`ARRAY[${sql.join(
    tagList.map((t) => sql`${t}`),
    sql`, `,
  )}]::text[]`
}

// mime_type patterns per category; `like` entries use LIKE, the rest match exactly.
const FILE_TYPE_MIMES: Record<Exclude<FileType, 'other'>, { exact: string[]; like: string[] }> = {
  pdf: { exact: ['application/pdf'], like: [] },
  image: { exact: [], like: ['image/%'] },
  document: {
    exact: ['application/msword', 'application/rtf', 'text/rtf', 'text/plain', 'application/vnd.oasis.opendocument.text'],
    like: ['%officedocument.wordprocessingml%'],
  },
  spreadsheet: {
    exact: ['application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv'],
    like: ['%officedocument.spreadsheetml%'],
  },
  archive: {
    exact: [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/vnd.rar',
      'application/x-7z-compressed',
      'application/gzip',
      'application/x-gzip',
      'application/x-tar',
    ],
    like: [],
  },
}

/** SQL condition on a mime_type column for one file category; `other` is everything else. */
function fileTypeCondition(type: FileType, mimeColumn: AnyColumn | SQL): SQL {
  const match = (t: Exclude<FileType, 'other'>) => {
    const { exact, like } = FILE_TYPE_MIMES[t]
    const parts = [
      ...exact.map((m) => sql`${mimeColumn} = ${m}`),
      ...like.map((p) => sql`${mimeColumn} LIKE ${p}`),
    ]
    return sql`(${sql.join(parts, sql` OR `)})`
  }
  if (type !== 'other') return match(type)
  const known = (Object.keys(FILE_TYPE_MIMES) as Exclude<FileType, 'other'>[]).map(match)
  return sql`NOT (${sql.join(known, sql` OR `)})`
}

const FILE_SORT_ORDER = {
  recent: [desc(archiveFiles.createdAt), asc(archiveFiles.id)],
  oldest: [asc(archiveFiles.createdAt), asc(archiveFiles.id)],
  name: [asc(archiveFiles.name), asc(archiveFiles.id)],
}

export async function listFiles(
  me: SessionUser,
  query: {
    folderId?: string
    q?: string
    tags?: string
    type?: FileType
    modifiedAfter?: Date
    page: number
    pageSize?: number
    sort?: 'recent' | 'oldest' | 'name'
  },
) {
  const folderId = query.folderId ?? (await ensureSpaceRoot(me))
  await assertAccess(me, folderId, VIEW_ACCESS)
  const pageSize = query.pageSize ?? 50
  const filters: SQL[] = [sql`${archiveFiles.deletedAt} IS NULL`, sql`${archiveFiles.folderId} = ${folderId}`]
  if (query.q) filters.push(foldedIlike(archiveFiles.name, query.q))
  if (query.type) filters.push(fileTypeCondition(query.type, archiveFiles.mimeType))
  if (query.modifiedAfter) filters.push(sql`${archiveFiles.updatedAt} >= ${query.modifiedAfter.toISOString()}`)
  const tagList = parseTagsFilter(query.tags)
  if (tagList.length > 0) filters.push(sql`${archiveFiles.tags} @> ${tagsContainSql(tagList)}`)

  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(archiveFiles)
      .where(and(...filters))
      .orderBy(...FILE_SORT_ORDER[query.sort ?? 'recent'])
      .limit(pageSize)
      .offset((query.page - 1) * pageSize),
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(archiveFiles)
      .where(and(...filters)),
  ])
  return { items: await withPreviewUrl(rows), total: counted?.total ?? 0, page: query.page, pageSize }
}

export interface ArchiveSearchFile {
  kind: 'file'
  id: string
  /** The person's level on the file's folder, so lists outside a folder show only allowed actions. */
  level: 'view' | 'edit'
  name: string
  mimeType: string
  sizeBytes: number
  tags: string[]
  folderId: string
  folderPath: { id: string; name: string }[]
  previewUrl: string | null
  updatedAt: Date
}

export interface ArchiveSearchFolder {
  kind: 'folder'
  id: string
  level: 'view' | 'edit'
  name: string
  color: number | null
  /** Null for the top of a space the person can see. */
  folderId: string | null
  /** The parent's path, without the folder itself. */
  folderPath: { id: string; name: string }[]
}

const SEARCH_LIMIT = 50

type FileRawRow = {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  tags: string[]
  folderId: string
  thumbnailR2Key: string | null
  r2Key: string
  folderPathIds: string[] | null
  folderPathNames: string[] | null
  lvl: number
  updatedAt: Date
}

const levelOf = (lvl: number) => (lvl >= EDIT_ACCESS ? ('edit' as const) : ('view' as const))

function pathOf(ids: string[] | null, names: string[] | null) {
  return (ids ?? []).map((id, i) => ({ id, name: names?.[i] ?? '' }))
}

async function toSearchFile(r: FileRawRow): Promise<ArchiveSearchFile> {
  return {
    kind: 'file',
    id: r.id,
    level: levelOf(r.lvl),
    name: r.name,
    mimeType: r.mimeType,
    sizeBytes: Number(r.sizeBytes),
    tags: r.tags,
    folderId: r.folderId,
    folderPath: pathOf(r.folderPathIds, r.folderPathNames),
    previewUrl: await computePreviewUrl(r),
    updatedAt: r.updatedAt,
  }
}

// Visible files across the whole archive (ignores folderId, unlike listFiles), with the full
// path of each file's folder. Access is filtered by the same CTE, so a file in another space
// never shows up.
async function searchFileRows(
  me: SessionUser,
  filter: { q: string; tags?: string; type?: FileType; modifiedAfter?: Date },
  limit: number,
): Promise<ArchiveSearchFile[]> {
  const tagList = parseTagsFilter(filter.tags)
  const extra: SQL[] = []
  if (tagList.length > 0) extra.push(sql`af.tags @> ${tagsContainSql(tagList)}`)
  if (filter.type) extra.push(fileTypeCondition(filter.type, sql`af.mime_type`))
  if (filter.modifiedAfter) extra.push(sql`af.updated_at >= ${filter.modifiedAfter.toISOString()}`)

  const rows = await db.execute<FileRawRow>(sql`
    ${accessiblePathsCte(me)}
    SELECT
      af.id, af.name, af.mime_type AS "mimeType", af.size_bytes AS "sizeBytes", af.tags,
      af.folder_id AS "folderId", af.thumbnail_r2_key AS "thumbnailR2Key", af.r2_key AS "r2Key",
      af.updated_at AS "updatedAt", fp.path_ids AS "folderPathIds", fp.path_names AS "folderPathNames", a.lvl
    FROM archive_files af
    JOIN folder_paths fp ON af.folder_id = fp.id
    JOIN access a ON a.id = af.folder_id
    WHERE af.deleted_at IS NULL AND ${foldedIlike(sql`af.name`, filter.q)}
      ${sql.join(
        extra.map((c) => sql`AND ${c}`),
        sql` `,
      )}
    ORDER BY af.name
    LIMIT ${limit}
  `)
  return Promise.all(rows.map(toSearchFile))
}

/** Files only: the global search and the assistant have no use for folders. */
export async function searchFiles(me: SessionUser, q: string, tags?: string): Promise<ArchiveSearchFile[]> {
  return searchFileRows(me, { q, tags }, 30)
}

/**
 * Files and folders, folders first, 50 results in all. The type, date and tag filters only
 * describe files, so with any of them set folders drop out.
 */
export async function searchArchive(
  me: SessionUser,
  filter: { q: string; tags?: string; type?: FileType; modifiedAfter?: Date },
): Promise<(ArchiveSearchFolder | ArchiveSearchFile)[]> {
  const folderRows = parseTagsFilter(filter.tags).length > 0 || filter.type || filter.modifiedAfter
    ? []
    : await db.execute<{
        id: string
        name: string
        color: number | null
        parentId: string | null
        pathIds: string[]
        pathNames: string[]
        lvl: number
      }>(sql`
        ${accessiblePathsCte(me)}
        SELECT f.id, f.name, f.color, f.parent_id AS "parentId", fp.path_ids AS "pathIds", fp.path_names AS "pathNames", a.lvl
          FROM archive_folders f
          JOIN folder_paths fp ON fp.id = f.id
          JOIN access a ON a.id = f.id
         WHERE f.deleted_at IS NULL AND ${foldedIlike(sql`f.name`, filter.q)}
         ORDER BY f.name
         LIMIT ${SEARCH_LIMIT}
      `)
  const folders: ArchiveSearchFolder[] = folderRows.map((r) => ({
    kind: 'folder',
    id: r.id,
    level: levelOf(r.lvl),
    name: r.name,
    color: r.color,
    // A top-level folder's path is just itself, so the parent is not visible to the person.
    folderId: r.pathIds.length > 1 ? r.parentId : null,
    folderPath: pathOf(r.pathIds.slice(0, -1), r.pathNames.slice(0, -1)),
  }))
  const files = await searchFileRows(me, filter, SEARCH_LIMIT - folders.length)
  return [...folders, ...files]
}

const FILE_RAW_COLUMNS = sql`
  af.id, af.name, af.mime_type AS "mimeType", af.size_bytes AS "sizeBytes", af.tags,
  af.folder_id AS "folderId", af.thumbnail_r2_key AS "thumbnailR2Key", af.r2_key AS "r2Key",
  af.created_at AS "createdAt", af.updated_at AS "updatedAt"`

/** The last 20 files changed in folders the person can see. */
export async function listRecent(me: SessionUser) {
  const rows = await db.execute<FileRawRow & { createdAt: Date; updatedAt: Date }>(sql`
    ${accessiblePathsCte(me)}
    SELECT ${FILE_RAW_COLUMNS}, fp.path_ids AS "folderPathIds", fp.path_names AS "folderPathNames", a.lvl
      FROM archive_files af
      JOIN folder_paths fp ON af.folder_id = fp.id
      JOIN access a ON a.id = af.folder_id
     WHERE af.deleted_at IS NULL
     ORDER BY af.updated_at DESC
     LIMIT 20
  `)
  return Promise.all(
    rows.map(async ({ folderPathIds, folderPathNames, lvl, ...r }) => ({
      ...r,
      level: levelOf(lvl),
      sizeBytes: Number(r.sizeBytes),
      folderPath: pathOf(folderPathIds, folderPathNames),
      previewUrl: await computePreviewUrl(r),
    })),
  )
}

// ── Stele ────────────────────────────────────────────────────────────────

export async function setStar(me: SessionUser, type: 'file' | 'folder', id: string) {
  if (type === 'file') await requireFile(me, id, VIEW_ACCESS)
  else await requireFolder(me, id, VIEW_ACCESS)
  await db
    .insert(archiveStars)
    .values({ userId: me.id, itemType: type, itemId: id })
    .onConflictDoNothing()
  return { starred: true }
}

// No visibility check: removing your own star on something you can no longer see is harmless.
export async function removeStar(me: SessionUser, type: 'file' | 'folder', id: string) {
  await db
    .delete(archiveStars)
    .where(and(eq(archiveStars.userId, me.id), eq(archiveStars.itemType, type), eq(archiveStars.itemId, id)))
  return { starred: false }
}

/** Starred items that are still visible to the person and not in the Trash. */
export async function listStars(me: SessionUser) {
  const [folders, fileRows] = await Promise.all([
    db.execute<{ id: string; name: string; color: number | null; parentId: string | null; lvl: number }>(sql`
      ${accessibleFoldersCte(me)}
      SELECT f.id, f.name, f.color, f.parent_id AS "parentId", a.lvl
        FROM archive_stars st
        JOIN archive_folders f ON f.id = st.item_id
        JOIN access a ON a.id = f.id AND a.lvl >= 1
       WHERE st.user_id = ${me.id} AND st.item_type = 'folder' AND f.deleted_at IS NULL
       ORDER BY f.name
    `),
    db.execute<Omit<FileRawRow, 'folderPathIds' | 'folderPathNames'> & { createdAt: Date; updatedAt: Date }>(sql`
      ${accessibleFoldersCte(me)}
      SELECT ${FILE_RAW_COLUMNS}, a.lvl
        FROM archive_stars st
        JOIN archive_files af ON af.id = st.item_id
        JOIN archive_folders fo ON fo.id = af.folder_id AND fo.deleted_at IS NULL
        JOIN access a ON a.id = af.folder_id AND a.lvl >= 1
       WHERE st.user_id = ${me.id} AND st.item_type = 'file' AND af.deleted_at IS NULL
       ORDER BY af.name
    `),
  ])
  const files = await withPreviewUrl(fileRows.map(({ lvl, ...r }) => ({ ...r, level: levelOf(lvl), sizeBytes: Number(r.sizeBytes) })))
  return { folders: folders.map(({ lvl, ...f }) => ({ ...f, level: levelOf(lvl) })), files }
}

async function isStarred(me: SessionUser, type: 'file' | 'folder', id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: archiveStars.id })
    .from(archiveStars)
    .where(and(eq(archiveStars.userId, me.id), eq(archiveStars.itemType, type), eq(archiveStars.itemId, id)))
  return Boolean(row)
}

async function personRef(userId: string | null): Promise<{ id: string; name: string } | null> {
  if (!userId) return null
  const [row] = await db
    .select({ id: users.id, name: sql<string>`COALESCE(NULLIF(${users.displayName}, ''), ${users.email})` })
    .from(users)
    .where(eq(users.id, userId))
  return row ?? null
}

// Shares on the folder and on every ancestor, one row per person: the strongest level wins,
// and on a tie the nearest folder. The ancestor walk carries a path guard (a cycle in
// parent_id must not loop).
// `visibleIds` = the folders on the path the reader can open. A share on a folder above them still
// gives access here, so the row stays, but the name of a folder the reader cannot open does not.
async function folderAccessList(folderId: string, visibleIds: string[]) {
  const rows = await db.execute<{
    userId: string
    name: string
    level: 'view' | 'edit'
    fromId: string
    fromName: string
    depth: number
  }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, ARRAY[id] AS path FROM archive_folders WHERE id = ${folderId}
      UNION ALL
      SELECT f.id, f.parent_id, up.path || f.id
        FROM archive_folders f
        JOIN up ON f.id = up.parent_id
       WHERE NOT (f.id = ANY(up.path))
    )
    SELECT DISTINCT ON (s.user_id)
           s.user_id AS "userId", COALESCE(NULLIF(u.display_name, ''), u.email) AS name, s.level,
           up.id AS "fromId", fo.name AS "fromName", cardinality(up.path) AS depth
      FROM up
      JOIN archive_folder_shares s ON s.folder_id = up.id AND s.deleted_at IS NULL
      JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
      JOIN archive_folders fo ON fo.id = up.id
     ORDER BY s.user_id, (s.level = 'edit') DESC, cardinality(up.path) ASC
  `)
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    level: r.level,
    inherited: r.fromId !== folderId,
    inheritedFrom: r.fromId !== folderId && visibleIds.includes(r.fromId) ? { id: r.fromId, name: r.fromName } : null,
  }))
}

export async function getFolderDetails(me: SessionUser, id: string) {
  await requireFolder(me, id, VIEW_ACCESS)
  const [folder] = await db.select().from(archiveFolders).where(eq(archiveFolders.id, id))
  if (!folder) throw new ArchiveNotFoundError()
  const location = await getFolderPath(me, id)
  const [starred, access, owner] = await Promise.all([
    isStarred(me, 'folder', id),
    folderAccessList(id, location.path.map((p) => p.id)),
    personRef(folder.ownerUserId),
  ])
  return {
    id: folder.id,
    name: folder.name,
    color: folder.color,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    path: location.path,
    createdBy: null,
    updatedBy: null,
    owner,
    starred,
    access,
  }
}

export async function getFileDetails(me: SessionUser, id: string) {
  const file = await requireFile(me, id, VIEW_ACCESS)
  const location = await getFolderPath(me, file.folderId)
  const [starred, access, owner, createdBy, updatedBy] = await Promise.all([
    isStarred(me, 'file', id),
    folderAccessList(file.folderId, location.path.map((p) => p.id)),
    personRef(location.ownerUserId),
    personRef(file.createdByUserId),
    personRef(file.updatedByUserId),
  ])
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    tags: file.tags,
    folderId: file.folderId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    path: location.path,
    createdBy,
    updatedBy,
    owner,
    starred,
    access,
  }
}

// Lanțul de strămoși pt. breadcrumb (folder accesibil → folder curent), inclusiv. Pornește de la
// cel mai de sus folder la care omul are acces, nu de la rădăcina fizică: un folder primit prin
// share are strămoși pe care omul nu îi vede, deci breadcrumb-ul ar dezvălui un arbore care nu-i
// aparține (`currentFolderId` e în URL, ArchivePage.tsx —Trail-ul se reconstruiește aici la load
// direct/refresh/back). Gol dacă id-ul nu există sau nu e accesibil → frontend cade pe rădăcina
// spațiului.
export async function getFolderPath(me: SessionUser, folderId: string) {
  const level = await folderAccessLevel(me, folderId)
  if (level < VIEW_ACCESS) throw new ArchiveNotFoundError()
  const rows = await db.execute<{ pathIds: string[]; pathNames: string[]; ownerUserId: string; ownerName: string }>(sql`
    ${accessiblePathsCte(me)}
    SELECT fp.path_ids AS "pathIds", fp.path_names AS "pathNames", f.owner_user_id AS "ownerUserId",
           COALESCE(NULLIF(u.display_name, ''), u.email) AS "ownerName"
      FROM folder_paths fp
      JOIN archive_folders f ON f.id = fp.id
      JOIN users u ON u.id = f.owner_user_id
     WHERE fp.id = ${folderId}
  `)
  const row = rows[0]
  if (!row) throw new ArchiveNotFoundError()
  // Nivelul și dreptul de share sunt pe folderul curent (ultimul din drum) — ce decide
  // butoanele din antetul paginii.
  return {
    path: row.pathIds.map((id, i) => ({ id, name: row.pathNames[i] ?? '' })),
    level: level >= EDIT_ACCESS ? ('edit' as const) : ('view' as const),
    canShare: canShareFolder(me, row.ownerUserId),
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
  }
}

export async function listAutoMonthlyFolders() {
  return db
    .select({ id: archiveFolders.id, name: archiveFolders.name })
    .from(archiveFolders)
    .where(and(eq(archiveFolders.autoMonthlySubfolders, true), sql`${archiveFolders.deletedAt} IS NULL`))
}

/** Găsește sau creează un folder cu `name` sub `parentId` (idempotent) — joburile
 *  (archive-monthly-folders) și arhivarea automată a facturilor (financial-archive.ts).
 *  Rulă ca „sistem": owner-ul vine de la părinte, deci folderul creat intră în spațiul în care
 *  se află cel care a pornit jobul. */
export async function ensureFolder(name: string, parentId: string): Promise<string> {
  const [parent] = await db
    .select({ ownerUserId: archiveFolders.ownerUserId })
    .from(archiveFolders)
    .where(and(eq(archiveFolders.id, parentId), sql`${archiveFolders.deletedAt} IS NULL`))
  if (!parent) throw new Error(tr('errors.archive.parentGone', { parentId }))
  const [existing] = await db
    .select({ id: archiveFolders.id })
    .from(archiveFolders)
    .where(
      and(
        eq(archiveFolders.parentId, parentId),
        eq(archiveFolders.name, name),
        sql`${archiveFolders.deletedAt} IS NULL`,
      ),
    )
  if (existing) return existing.id
  const [created] = await db
    .insert(archiveFolders)
    .values({ name, parentId, ownerUserId: parent.ownerUserId })
    .returning({ id: archiveFolders.id })
  if (!created) throw new Error(tr('errors.archive.folderNotCreated', { name }))
  return created.id
}

/**
 * Găsește/creează întregul lanț de foldere pe sub o rădăcină dată, întorcând id-ul ultimului
 * segment. Ex: ensureFolderPath(rootId, ['Contabilitate', '07-2026', 'Facturi furnizori']) —
 * rădăcina e explicită de la caller, pentru că joburile trebuie să scrie în spațiul pe care
 * Stefan l-a ales, nu într-o rădăcină comună care nu mai există.
 */
export async function ensureFolderPath(rootId: string, names: string[]): Promise<string> {
  let parentId: string | undefined = rootId
  for (const name of names) {
    parentId = await ensureFolder(name, parentId)
  }
  if (!parentId) throw new Error('ensureFolderPath needs at least one folder name')
  return parentId
}

// Read-only, spre deosebire de ensureFolderPath (care creează lanțul lipsă) — folosit de
// pachetul trimestrial (Sprint D, Track B), care nu trebuie să creeze foldere goale pt. o
// lună fără nicio factură arhivată încă.
export async function findFolderIdByPath(rootId: string, names: string[]): Promise<string | null> {
  let parentId: string | undefined = rootId
  for (const name of names) {
    const [row] = await db
      .select({ id: archiveFolders.id })
      .from(archiveFolders)
      .where(
        and(
          parentId ? eq(archiveFolders.parentId, parentId) : eq(archiveFolders.id, rootId),
          eq(archiveFolders.name, name),
          sql`${archiveFolders.deletedAt} IS NULL`,
        ),
      )
    if (!row) return null
    parentId = row.id
  }
  return parentId ?? null
}

export interface RecursiveArchiveFile {
  id: string
  name: string
  r2Key: string
  mimeType: string
  folderPathNames: string[]
}

// Toate fișierele dintr-un folder ȘI toți descendenții lui — CTE recursiv, același pattern ca
// wouldCreateCycle/searchFiles. Folosit de pachetul trimestrial (zip cu tot ce a fost arhivat
// automat într-o lună, indiferent de subfolderul pe furnizor/client).
export async function listFilesUnderFolderRecursive(rootFolderId: string): Promise<RecursiveArchiveFile[]> {
  const rows = await db.execute<{
    id: string
    name: string
    r2Key: string
    mimeType: string
    folderPathNames: string[]
  }>(sql`
    WITH RECURSIVE subfolders AS (
      SELECT id, ARRAY[id] AS path_ids, ARRAY[]::text[] AS path_names FROM archive_folders WHERE id = ${rootFolderId}
      UNION ALL
      SELECT f.id, sf.path_ids || f.id, sf.path_names || f.name
      FROM archive_folders f
      JOIN subfolders sf ON f.parent_id = sf.id
      WHERE f.deleted_at IS NULL AND NOT (f.id = ANY(sf.path_ids))
    )
    SELECT af.id, af.name, af.r2_key AS "r2Key", af.mime_type AS "mimeType", sf.path_names AS "folderPathNames"
    FROM archive_files af
    JOIN subfolders sf ON af.folder_id = sf.id
    WHERE af.deleted_at IS NULL
    ORDER BY sf.path_names, af.name
  `)
  return rows
}

export interface FolderZipResult {
  buffer: Buffer
  fileName: string
}

/** Zip cu tot conținutul unui folder (recursiv, subfoldere incluse) — cerut de Stefan, nu
 *  exista deloc înainte (doar view/download per fișier). Best-effort per fișier (regula #7
 *  CLAUDE.md): un obiect R2 lipsă/eșuat nu oprește restul arhivei, doar lipsește din zip —
 *  la fel ca collectArchiveFilesForMonths (shared/lib/archive-export.ts), care folosește
 *  exact același listFilesUnderFolderRecursive. Bufferat integral în memorie — arhivă
 *  personală, foldere mici, fără cost real (fflate.zipSync, deja folosit de pachetul
 *  trimestrial, nicio dependență nouă). null dacă folderul nu e accesibil. */
export async function buildFolderZipBuffer(me: SessionUser, folderId: string): Promise<FolderZipResult | null> {
  const folder = await requireFolder(me, folderId, VIEW_ACCESS).catch(() => null)
  if (!folder) return null

  const files = await listFilesUnderFolderRecursive(folderId)
  const zipEntries: Record<string, Uint8Array> = {}
  for (const file of files) {
    try {
      const buffer = await downloadFromR2(file.r2Key)
      zipEntries[[...file.folderPathNames, file.name].join('/')] = new Uint8Array(buffer)
    } catch (err) {
      console.error(`[archive] nu am putut descărca "${file.name}" (${file.r2Key}) pt. zip folder: ${String(err)}`)
    }
  }

  return { buffer: Buffer.from(zipSync(zipEntries)), fileName: `${folder.name}.zip` }
}

// ── Spațiu R2 (plan gratuit Cloudflare: 10GB) ───────────────────────────────

export interface StorageUsage {
  /** Spațiul omului — singurul număr care contează pentru un coleg. */
  usedBytes: number
  limitBytes: number
  /** Totalul firmei, doar pentru cine administrează spațiile (admin / `arhiva.administrare`). */
  totalUsedBytes: number | null
}

/** SUM SQL (regula #9 CLAUDE.md) pe fișierele active, pe spațiul omului — soft-șterse nu mai
 *  ocupă loc "vizibil" pt. om, deși obiectul R2 rămâne până la ștergerea permanentă. */
export async function getStorageUsage(me: SessionUser): Promise<StorageUsage> {
  const [own] = await db
    .select({ total: sql<number>`COALESCE(SUM(${archiveFiles.sizeBytes}), 0)::bigint` })
    .from(archiveFiles)
    .innerJoin(archiveFolders, eq(archiveFolders.id, archiveFiles.folderId))
    .where(and(sql`${archiveFiles.deletedAt} IS NULL`, eq(archiveFolders.ownerUserId, me.id)))
  const result: StorageUsage = {
    usedBytes: Number(own?.total ?? 0),
    limitBytes: config.r2.freeTierLimitGb * 1024 ** 3,
    totalUsedBytes: null,
  }
  if (managesAllSpaces(me)) {
    const [all] = await db
      .select({ total: sql<number>`COALESCE(SUM(${archiveFiles.sizeBytes}), 0)::bigint` })
      .from(archiveFiles)
      .where(sql`${archiveFiles.deletedAt} IS NULL`)
    result.totalUsedBytes = Number(all?.total ?? 0)
  }
  return result
}

export async function findFileByName(folderId: string, name: string) {
  const [row] = await db
    .select({ id: archiveFiles.id })
    .from(archiveFiles)
    .where(and(eq(archiveFiles.folderId, folderId), eq(archiveFiles.name, name), sql`${archiveFiles.deletedAt} IS NULL`))
  return row
}

// "LL-AAAA" (ex: "07-2026") — convenția de nume pt. subfolderele lunare din Contabilitate,
// folosită atât de subfolderul creat manual/prin toggle (jobs/archive-monthly-folders.ts,
// pt. luna curentă) cât și de arhivarea facturilor (pt. luna emiterii facturii).
export function monthYearFolderName(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${month}-${date.getUTCFullYear()}`
}

// Upload dintr-un buffer deja în memorie (nu stream) — folosit atât de ruta HTTP (PDF-uri,
// bufferate pt. thumbnail) cât și de arhivarea automată a facturilor (fișiere citite de pe
// disc din STORAGE_DIR). Thumbnail generat best-effort doar pt. PDF (shared/lib/thumbnail.ts).
//
// `folderId` lipsă = rădăcina spațiului omului (share target din APK); cu `me` se verifică
// dreptul de editare în folderul țintă, ca un upload să nu poată intra într-un spațiu al altcuia.
async function storeUpload(input: {
  folderId: string
  name: string
  mimeType: string
  buffer: Buffer
  tags?: string[]
}) {
  const safeName = input.name.replace(/[/\\]/g, '_')
  const r2Key = `archive/${randomUUID()}-${safeName}`
  await uploadToR2(r2Key, Readable.from(input.buffer), input.mimeType)

  let thumbnailR2Key: string | undefined
  if (input.mimeType === 'application/pdf') {
    const thumbnail = await generatePdfThumbnail(input.buffer)
    if (thumbnail) {
      const thumbKey = `archive/thumbnails/${randomUUID()}.jpg`
      try {
        await uploadToR2(thumbKey, Readable.from(thumbnail), 'image/jpeg')
        thumbnailR2Key = thumbKey
      } catch {
        /* thumbnail opțional, nu blocăm crearea rândului */
      }
    }
  }

  const [row] = await db
    .insert(archiveFiles)
    .values({
      folderId: input.folderId,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.byteLength,
      r2Key,
      thumbnailR2Key,
      tags: input.tags ?? [],
    })
    .returning()
  if (!row) throw new Error(tr('errors.archive.fileNotCreated'))
  return row
}

export async function uploadFile(
  me: SessionUser,
  input: { folderId?: string; name: string; mimeType: string; buffer: Buffer; tags?: string[] },
) {
  const folderId = input.folderId ?? (await ensureSpaceRoot(me))
  await assertAccess(me, folderId, EDIT_ACCESS)
  return storeUpload({ ...input, folderId })
}

/** Upload fără un om în sesiune — doar joburile de sistem (arhivarea automată a facturilor),
 *  care scriu în folderul pe care `systemArchiveRoot()` l-a ales. */
export async function uploadSystemFile(input: {
  folderId: string
  name: string
  mimeType: string
  buffer: Buffer
  tags?: string[]
}) {
  return storeUpload(input)
}

// Numele funcției rămas din prima variantă (ambele fluxuri — preview ȘI descărcare reală —
// treceau cândva prin acest URL presemnat); azi ăsta e DOAR preview-ul deschis la click pe rând
// (previewFile din ArchivePage.tsx, tab nou). Descărcarea reală ("Descarcă" din meniu) merge pe
// alt endpoint, same-origin streaming (vezi routes.ts::/download, ArchivePage.tsx::downloadFile),
// cu `attachment` acolo. `inline` aici — altfel un click pe fișier îl și deschidea în tab nou, ȘI
// îl descărca automat pe disc (bug real Stefan, 2026-09-03: butonul de descărcat există deja,
// separat, exact pt. cazul în care chiar vrea asta).
export async function getFileForDownload(me: SessionUser, id: string) {
  const file = await requireFile(me, id, VIEW_ACCESS)
  const ttlSeconds = 900
  // Numele din DB (posibil redenumit de om), nu cheia R2 — altfel titlul tab-ului de preview
  // arăta numele lung generat la upload.
  const url = await getPresignedDownloadUrl(
    file.r2Key,
    ttlSeconds,
    `inline; filename="${file.name.replace(/"/g, "'")}"`,
  )
  return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() }
}

/** Fișierul, cu verificarea de acces pe folderul lui — 404 dacă e din alt spațiu (un id
 *  cunoscut direct, ca la atașamentele din Mesaje, nu trebuie să dea 403). */
export async function requireFile(me: SessionUser, id: string, min: 1 | 2) {
  const [file] = await db
    .select()
    .from(archiveFiles)
    .where(and(eq(archiveFiles.id, id), sql`${archiveFiles.deletedAt} IS NULL`))
  if (!file) throw new ArchiveNotFoundError()
  if ((await folderAccessLevel(me, file.folderId)) < min) throw new ArchiveNotFoundError()
  return file
}

/**
 * 2026-08-11 (bug Stefan — "network error" la atașare din Arhivă în email) — URL-ul presemnat
 * de mai sus e generat pe endpoint-ul S3 direct al R2 (`<bucket>.<account>.eu.r2.cloudflarestorage.com`),
 * NU pe accesul public al bucket-ului — Cloudflare NU aplică politica de CORS a bucket-ului pe
 * calea asta (confirmat direct: GET cu header Origin pe un URL presemnat real, zero header
 * `Access-Control-Allow-Origin` în răspuns, indiferent de regula CORS setată din dashboard).
 * Bun pt. `window.open`/download direct din browser (navigare, nu supusă CORS), dar
 * `ArchiveAttachPicker.tsx` are nevoie să CITEASCĂ bytes-ii în JS (ca să-i atașeze la email) —
 * fetch() cross-origin fără CORS e blocat de browser. Soluție: streaming prin backend-ul
 * NOSTRU (same-origin cu dash.vanadium.systems, deja autentificat prin sesiune) — fără nicio
 * dependență de CORS pe R2.
 */
export async function getFileBufferForDownload(
  me: SessionUser,
  id: string,
): Promise<{ buffer: Buffer; name: string; mimeType: string } | null> {
  const file = await requireFile(me, id, VIEW_ACCESS).catch(() => null)
  if (!file) return null
  const buffer = await downloadFromR2(file.r2Key)
  return { buffer, name: file.name, mimeType: file.mimeType }
}

export async function updateFile(me: SessionUser, id: string, input: { name?: string; folderId?: string; tags?: string[] }) {
  const before = await requireFile(me, id, EDIT_ACCESS)
  if (input.folderId) await assertAccess(me, input.folderId, EDIT_ACCESS)
  const patch: Partial<typeof archiveFiles.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) patch.name = input.name
  if (input.tags !== undefined) patch.tags = input.tags
  if (input.folderId !== undefined) patch.folderId = input.folderId
  const [row] = await db
    .update(archiveFiles)
    .set(patch)
    .where(and(eq(archiveFiles.id, id), sql`${archiveFiles.deletedAt} IS NULL`))
    .returning()
  // The previous name and folder let the client undo the change with one more PATCH.
  return row ? { ...row, previousName: before.name, previousFolderId: before.folderId } : row
}

// ── Spațiile și partajarea ──────────────────────────────────────────────

export interface SpaceEntry {
  id: string
  name: string
  /** `own` = rădăcina spațiului omului, `shared` = folder dat lui de altcineva, `space` = rădăcină
   *  a altui om (doar pentru cine administrează spațiile). */
  kind: 'own' | 'shared' | 'space'
  level: 'view' | 'edit'
  ownerUserId: string
  ownerName: string
}

export interface SpacesResponse {
  own: { id: string; name: string } | null
  shared: SpaceEntry[]
  /** Rădăcinile tuturor spațiilor, grupate de frontend pe om — null dacă nu administrează. */
  spaces: SpaceEntry[] | null
}

/** Ecranul de sus al Arhivei: „Spațiul meu", „Partajate cu mine" și (pt. administrare)
 *  „Toate spațiile". Un folder primit prin share apare aici chiar dacă se află în adâncul
 *  spațiului altcuia — e singurul mod de a ajunge la el. */
export async function listSpaces(me: SessionUser): Promise<SpacesResponse> {
  const ownRootId = await ensureSpaceRoot(me)
  const [ownRoot] = await db
    .select({ id: archiveFolders.id, name: archiveFolders.name })
    .from(archiveFolders)
    .where(eq(archiveFolders.id, ownRootId))

  // Share-urile lui, cu nivelul efectiv după tot ce e mai sus în arbore (un „view" pe un
  // subfolder al unui „edit" e tot „edit").
  const sharedRows = await db.execute<{ id: string; name: string; lvl: number; ownerUserId: string; ownerName: string }>(sql`
    WITH RECURSIVE granted AS (
      SELECT f."id" AS id, 2 AS lvl
        FROM "archive_folders" f
       WHERE f."owner_user_id" = ${me.id}
      UNION
      SELECT s."folder_id", CASE s."level" WHEN 'edit' THEN 2 ELSE 1 END
        FROM "archive_folder_shares" s
       WHERE s."user_id" = ${me.id} AND s."deleted_at" IS NULL
    ), spread AS (
      SELECT id, lvl FROM granted
      UNION
      SELECT c."id", sp.lvl FROM "archive_folders" c JOIN spread sp ON c."parent_id" = sp.id
       WHERE c."deleted_at" IS NULL
    ), access AS (
      SELECT id, MAX(lvl)::int AS lvl FROM spread GROUP BY id
    )
    SELECT s."id", s."name", s."owner_user_id" AS "ownerUserId",
           COALESCE(NULLIF(u."display_name", ''), u."email") AS "ownerName",
           a.lvl
      FROM access a
      JOIN "archive_folder_shares" sh ON sh."folder_id" = a.id AND sh."user_id" = ${me.id} AND sh."deleted_at" IS NULL
      JOIN "archive_folders" s ON s."id" = a.id AND s."deleted_at" IS NULL
      JOIN "users" u ON u."id" = s."owner_user_id"
     WHERE s."id" <> ${ownRootId} AND s."owner_user_id" <> ${me.id}
       AND NOT EXISTS (SELECT 1 FROM "archive_folders" p WHERE p."id" = s."parent_id" AND p."id" IN (SELECT id FROM access))
    ORDER BY "ownerName", s."name"
  `)

  const shared: SpaceEntry[] = sharedRows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: 'shared',
    level: r.lvl >= 2 ? 'edit' : 'view',
    ownerUserId: r.ownerUserId,
    ownerName: r.ownerName,
  }))

  const spaces = managesAllSpaces(me)
    ? (await listAllSpaceRoots()).map((r) => ({
        id: r.id,
        name: r.name,
        kind: 'space' as const,
        level: r.ownerUserId === me.id ? ('edit' as const) : ('view' as const),
        ownerUserId: r.ownerUserId,
        ownerName: r.ownerName,
      }))
    : null

  return { own: ownRoot ?? null, shared, spaces }
}

// Share-ul îl dă doar proprietarul folderului sau adminul — cine are doar „editează" lucrează
// în folder, nu îl dă mai departe (decizie Stefan, 2026-09-30).
function canShareFolder(me: SessionUser, ownerUserId: string): boolean {
  return ownerUserId === me.id || me.role?.kind === 'admin'
}

async function assertCanShare(me: SessionUser, folderId: string) {
  const [folder] = await db
    .select({ ownerUserId: archiveFolders.ownerUserId })
    .from(archiveFolders)
    .where(and(eq(archiveFolders.id, folderId), sql`${archiveFolders.deletedAt} IS NULL`))
  if (!folder || !canShareFolder(me, folder.ownerUserId)) throw new ArchiveNotFoundError()
}

export async function listShares(me: SessionUser, folderId: string) {
  await requireFolder(me, folderId, VIEW_ACCESS)
  await assertCanShare(me, folderId)
  return listFolderShares(folderId)
}

export async function setShare(me: SessionUser, folderId: string, userId: string, level: 'view' | 'edit') {
  await assertCanShare(me, folderId)
  if (userId === me.id) throw new ArchiveConflictError(tr('errors.archive.shareWithSelf'))
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), sql`${users.deletedAt} IS NULL`))
  if (!target) throw new ArchiveNotFoundError()
  const before = (await listFolderShares(folderId)).find((s) => s.userId === userId)?.level ?? null
  await db
    .insert(archiveFolderShares)
    .values({ folderId, userId, level })
    .onConflictDoUpdate({
      target: [archiveFolderShares.folderId, archiveFolderShares.userId],
      set: { level, updatedAt: new Date(), deletedAt: null },
    })
  await recordAudit({
    action: 'arhiva.share.adaugat',
    entityType: 'archive_folder',
    entityId: folderId,
    changes: { utilizator: [before, `${level}:${target.id}`] },
  })
  return listFolderShares(folderId)
}

export async function removeShare(me: SessionUser, folderId: string, userId: string) {
  await assertCanShare(me, folderId)
  await db
    .update(archiveFolderShares)
    .set({ deletedAt: new Date() })
    .where(and(eq(archiveFolderShares.folderId, folderId), eq(archiveFolderShares.userId, userId)))
  await recordAudit({
    action: 'arhiva.share.scos',
    entityType: 'archive_folder',
    entityId: folderId,
    changes: { utilizator: [userId, null] },
  })
  return listFolderShares(folderId)
}

/**
 * Schimbă proprietarul unui folder — tot subarborele lui, deci spațiul întreg se mută la
 * omul nou. Doar admin / `arhiva.administrare` (asta e și rostul funcționalității).
 */
export async function assignFolder(me: SessionUser, folderId: string, toUserId: string) {
  if (!managesAllSpaces(me)) throw new ArchiveNotFoundError()
  const before = await requireFolder(me, folderId, VIEW_ACCESS)
  if (before.ownerUserId === toUserId) return { id: folderId, ownerUserId: toUserId }
  await db.execute(sql`
    WITH RECURSIVE sub AS (
      SELECT id FROM archive_folders WHERE id = ${folderId}
      UNION
      SELECT f.id FROM archive_folders f JOIN sub s ON f.parent_id = s.id
    )
    UPDATE archive_folders SET owner_user_id = ${toUserId}, updated_at = now()
     WHERE id IN (SELECT id FROM sub)
  `)
  await recordAudit({
    action: 'arhiva.folder.atribuit',
    entityType: 'archive_folder',
    entityId: folderId,
    changes: { owner: [before.ownerUserId, toUserId] },
  })
  return { id: folderId, ownerUserId: toUserId }
}

/** Toate spațiile unui om, dintr-un singur click („Atribuie folderele lui" din Echipă). */
export async function assignAllSpaces(me: SessionUser, fromUserId: string, toUserId: string) {
  if (!managesAllSpaces(me)) throw new ArchiveNotFoundError()
  const moved = await db
    .update(archiveFolders)
    .set({ ownerUserId: toUserId, updatedAt: new Date() })
    .where(eq(archiveFolders.ownerUserId, fromUserId))
    .returning({ id: archiveFolders.id })
  await recordAudit({
    action: 'arhiva.spatii.atribuite',
    entityType: 'user',
    entityId: fromUserId,
    changes: { spatii: [null, moved.length] },
  })
  return { moved: moved.length }
}