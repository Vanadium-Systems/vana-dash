import { Star } from 'lucide-react'
import { Highlight } from '@/shared/components/Highlight'
import { FILE_TYPE_ICON, fileCategory, splitExtension } from '@/shared/lib/file-type'
import { t } from '@/shared/lib/i18n'
import { FolderGlyph } from './FolderGlyph'
import type { ArchiveItem } from './items'

export function ItemGlyph({ item, className = 'h-4 w-4' }: { item: ArchiveItem; className?: string }) {
  if (item.kind === 'folder') return <FolderGlyph color={item.color} className={className} />
  const Icon = FILE_TYPE_ICON[fileCategory(item.mimeType)]
  return <Icon aria-hidden="true" className={`${className} shrink-0 text-muted-foreground`} />
}

/** The name cut with "…" before its extension, so ".pdf" always stays readable. */
export function ItemName({ item, query }: { item: ArchiveItem; query: string }) {
  const { base, extension } = item.kind === 'file' ? splitExtension(item.name) : { base: item.name, extension: '' }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="flex min-w-0 font-medium" title={item.name}>
        <span className="truncate">
          <Highlight text={base} query={query} />
        </span>
        {extension ? <span className="shrink-0">{extension}</span> : null}
      </span>
      {item.starred ? <Star className="h-3 w-3 shrink-0 fill-warning text-warning" aria-label={t('archive:menu.starred')} /> : null}
    </span>
  )
}
