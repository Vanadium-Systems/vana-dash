import { SlidersHorizontal, X } from 'lucide-react'
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

/** An applied filter, removed with its ×. */
export function FilterChip({ label, swatch, onRemove }: { label: string; swatch?: string; onRemove: () => void }) {
  const removeLabel = t('common:filter.remove', { filter: label })
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-sm">
      {swatch ? <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: swatch }} /> : null}
      {label}
      <button type="button" onClick={onRemove} title={removeLabel} aria-label={removeLabel} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  )
}
