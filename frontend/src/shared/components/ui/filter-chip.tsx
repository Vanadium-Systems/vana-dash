import { SlidersHorizontal, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { t } from '@/shared/lib/i18n'

/** The "Filtru" button that opens a list's filter menu; goes inside a `DropdownMenu`. */
export function FilterMenuTrigger() {
  return (
    <DropdownMenuTrigger className="inline-flex h-control-md items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {t('common:filter.add')}
    </DropdownMenuTrigger>
  )
}

/** An applied filter, removed with its ×. `renderLabel` makes the label a trigger (a menu that edits the value); without it the label is plain text. */
export function FilterChip({ label, swatch, note, onRemove, renderLabel }: { label: string; swatch?: string; /** Small text after the label (where the filter came from). */ note?: string; onRemove: () => void; renderLabel?: (label: string) => ReactNode }) {
  const removeLabel = t('common:filter.remove', { filter: label })
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-sm">
      {swatch ? <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: swatch }} /> : null}
      {renderLabel ? renderLabel(label) : label}
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      <button type="button" onClick={onRemove} title={removeLabel} aria-label={removeLabel} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  )
}
