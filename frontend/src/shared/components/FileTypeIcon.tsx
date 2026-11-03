import { File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, type LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

// A file's kind at a glance, from its extension first (browsers send `application/octet-stream`
// for half of what people upload) and its content type second. Colour only where the kind is
// common enough to be recognised by it: PDF red, spreadsheets green, documents blue, archives amber.

export type FileKind = 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'image' | 'video' | 'audio' | 'code' | 'other'

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', svg: 'image',
  mp4: 'video', mov: 'video', webm: 'video', '3gp': 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', opus: 'audio',
  json: 'code', xml: 'code', html: 'code', js: 'code', ts: 'code', sql: 'code',
}

export function fileKind(filename: string, contentType = ''): FileKind {
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  if (BY_EXTENSION[extension]) return BY_EXTENSION[extension]
  if (contentType === 'application/pdf') return 'pdf'
  const family = contentType.split('/')[0]
  if (family === 'image' || family === 'video' || family === 'audio') return family
  return 'other'
}

const STYLE: Record<FileKind, { icon: LucideIcon; tone: string }> = {
  pdf: { icon: FileText, tone: 'bg-destructive/10 text-destructive-text' },
  doc: { icon: FileText, tone: 'bg-primary/10 text-primary' },
  sheet: { icon: FileSpreadsheet, tone: 'bg-success/10 text-success-text' },
  slides: { icon: Presentation, tone: 'bg-warning/10 text-warning-text' },
  archive: { icon: FileArchive, tone: 'bg-warning/10 text-warning-text' },
  image: { icon: FileImage, tone: 'bg-muted text-muted-foreground' },
  video: { icon: FileVideo, tone: 'bg-muted text-muted-foreground' },
  audio: { icon: FileAudio, tone: 'bg-muted text-muted-foreground' },
  code: { icon: FileCode, tone: 'bg-muted text-muted-foreground' },
  other: { icon: File, tone: 'bg-muted text-muted-foreground' },
}

export function FileTypeIcon({ filename, contentType, size = 'md', className }: { filename: string; contentType?: string; size?: 'sm' | 'md'; className?: string }) {
  const { icon: Icon, tone } = STYLE[fileKind(filename, contentType)]
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-md', size === 'md' ? 'h-9 w-9' : 'h-7 w-7', tone, className)} aria-hidden="true">
      <Icon className={size === 'md' ? 'h-5 w-5' : 'h-4 w-4'} />
    </span>
  )
}
