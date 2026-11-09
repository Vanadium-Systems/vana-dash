import { File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileType, FileVideo, type LucideIcon } from 'lucide-react'
import { t, type TKey } from './i18n'

// What a file is, in words and by the shape of its icon (colour is for state, and the type has to
// read without it). The mapping follows `FILE_TYPE_MIMES` in the backend's archive service, so the
// "Tip" filter and the word on a row agree; video and audio exist only here, the filter files them
// under "other".

export type FileCategory = 'pdf' | 'image' | 'document' | 'spreadsheet' | 'archive' | 'video' | 'audio' | 'other'

/** The categories the backend's `type` filter knows. */
export const FILTER_FILE_TYPES = ['pdf', 'image', 'document', 'spreadsheet', 'archive', 'other'] as const

const DOCUMENT_MIMES = new Set([
  'application/msword',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'application/vnd.oasis.opendocument.text',
])
const SPREADSHEET_MIMES = new Set(['application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv'])
const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
])

export function fileCategory(mimeType: string): FileCategory {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (DOCUMENT_MIMES.has(mimeType) || mimeType.includes('officedocument.wordprocessingml')) return 'document'
  if (SPREADSHEET_MIMES.has(mimeType) || mimeType.includes('officedocument.spreadsheetml')) return 'spreadsheet'
  if (ARCHIVE_MIMES.has(mimeType)) return 'archive'
  return 'other'
}

const LABEL_KEY = {
  pdf: 'archive:types.pdf',
  image: 'archive:types.image',
  document: 'archive:types.document',
  spreadsheet: 'archive:types.spreadsheet',
  archive: 'archive:types.archive',
  video: 'archive:types.video',
  audio: 'archive:types.audio',
  other: 'archive:types.other',
} as const satisfies Record<FileCategory, TKey>

export function fileTypeLabel(category: FileCategory): string {
  return t(LABEL_KEY[category])
}

export const FILE_TYPE_ICON: Record<FileCategory, LucideIcon> = {
  pdf: FileText,
  image: FileImage,
  document: FileType,
  spreadsheet: FileSpreadsheet,
  archive: FileArchive,
  video: FileVideo,
  audio: FileAudio,
  other: File,
}

/** "Facturi 2025.pdf" → the part that may be cut with "…" and the extension that must stay visible. */
export function splitExtension(name: string): { base: string; extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || name.length - dot > 8) return { base: name, extension: '' }
  return { base: name.slice(0, dot), extension: name.slice(dot) }
}
