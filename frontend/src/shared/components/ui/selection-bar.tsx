import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './button'
import { Checkbox } from './checkbox'
import { t } from '@/shared/lib/i18n'

// Floats at the bottom centre while something is selected, instead of a toolbar that pushes the
// list down (E6, X3). On a phone it sits above the bottom nav. The actions are the page's own.
export function SelectionBar({
  count,
  allSelected,
  onSelectAll,
  onClear,
  children,
}: {
  count: number
  allSelected: boolean
  onSelectAll: () => void
  onClear: () => void
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <div
      role="toolbar"
      aria-label={t('common:selection.toolbar')}
      className="float-in glass fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-40 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-full border px-2 py-1.5 shadow-lg md:bottom-6"
    >
      <Button variant="ghost" size="icon-sm" title={t('common:selection.clear')} aria-label={t('common:selection.clear')} onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
      <label className="flex items-center gap-2 px-1 text-sm">
        <Checkbox checked={allSelected} indeterminate={!allSelected} onChange={() => (allSelected ? onClear() : onSelectAll())} aria-label={t('common:selection.all')} />
        <span className="tnum whitespace-nowrap">{t('common:selection.count', { count })}</span>
      </label>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      {children}
    </div>
  )
}
