import { Folder } from 'lucide-react'
import { tagColor } from '@/shared/lib/tag-colors'
import { cn } from '@/shared/lib/utils'

/** Filled in the folder's color (`--tag-*`), muted without one. */
export function FolderGlyph({ color, className }: { color: number | null; className?: string }) {
  return (
    <Folder
      aria-hidden="true"
      fill="currentColor"
      fillOpacity={0.25}
      className={cn('shrink-0', color === null && 'text-muted-foreground', className)}
      style={color === null ? undefined : { color: tagColor(color) }}
    />
  )
}
