import type { ArchiveFile, ArchiveFolder, ArchiveSearchHit } from '@/shared/lib/types'

type Place = { id: string; name: string }[]

/** A row of the Archive, whether it came from a folder listing, a search, Recent or Starred. */
export interface ArchiveItem {
  kind: 'file' | 'folder'
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  updatedAt: string | null
  previewUrl: string | null
  tags: string[]
  color: number | null
  starred: boolean
  fileCount: number
  subfolderCount: number
  /** Whether write actions are offered. Where the level is unknown (a search hit) the server decides. */
  canWrite: boolean
  canShare: boolean
  ownerUserId: string | null
  autoMonthlySubfolders: boolean
  /** The folder the item sits in, shown where the list is not that folder (search, Recent, Starred). */
  location: Place | null
}

const base = {
  mimeType: '',
  sizeBytes: 0,
  updatedAt: null,
  previewUrl: null,
  tags: [],
  color: null,
  fileCount: 0,
  subfolderCount: 0,
  canShare: false,
  ownerUserId: null,
  autoMonthlySubfolders: false,
  location: null,
} satisfies Partial<ArchiveItem>

export function fileItem(file: ArchiveFile, options: { starred: boolean; canWrite: boolean; location?: Place | null }): ArchiveItem {
  return {
    ...base,
    kind: 'file',
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    updatedAt: file.updatedAt,
    previewUrl: file.previewUrl,
    tags: file.tags,
    starred: options.starred,
    canWrite: options.canWrite,
    location: options.location ?? null,
  }
}

export function folderItem(folder: ArchiveFolder): ArchiveItem {
  return {
    ...base,
    kind: 'folder',
    id: folder.id,
    name: folder.name,
    color: folder.color,
    starred: folder.starred,
    fileCount: folder.fileCount,
    subfolderCount: folder.subfolderCount,
    canWrite: folder.level === 'edit',
    canShare: folder.canShare,
    ownerUserId: folder.ownerUserId,
    autoMonthlySubfolders: folder.autoMonthlySubfolders,
  }
}

export function starredFolderItem(folder: { id: string; name: string; color: number | null }, canWrite: boolean): ArchiveItem {
  return { ...base, kind: 'folder', id: folder.id, name: folder.name, color: folder.color, starred: true, canWrite }
}

export function hitItem(hit: ArchiveSearchHit, options: { starredIds: Set<string>; canWrite: boolean }): ArchiveItem {
  const starred = options.starredIds.has(hit.id)
  if (hit.kind === 'folder') {
    return { ...base, kind: 'folder', id: hit.id, name: hit.name, color: hit.color, starred, canWrite: options.canWrite, location: hit.folderPath }
  }
  return {
    ...base,
    kind: 'file',
    id: hit.id,
    name: hit.name,
    mimeType: hit.mimeType,
    sizeBytes: hit.sizeBytes,
    updatedAt: hit.updatedAt,
    previewUrl: hit.previewUrl,
    tags: hit.tags,
    starred,
    canWrite: options.canWrite,
    location: hit.folderPath,
  }
}
