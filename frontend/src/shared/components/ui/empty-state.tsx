import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { Button } from './button'
import { t } from '@/shared/lib/i18n'

// Două stări goale distincte (DESIGN.md, Stări): `new` = încă nu există nimic, cu o singură
// acțiune de pornire; `filtered` = există date, dar filtrul le ascunde, cu resetare.

interface EmptyStateProps {
  kind: 'new' | 'filtered'
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  onReset?: () => void
  className?: string
  /**
   * `new` only, on list screens: one example row, marked as such, so an empty list shows what will
   * appear there (DESIGN.md). It goes away with the first real row, because the list stops being empty.
   */
  demoRow?: React.ReactNode
}

export function EmptyState({ kind, title, description, action, onReset, className, demoRow }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-10 text-center', className)}>
      {kind === 'new' && demoRow ? (
        <div className="relative mb-4 w-full max-w-xl rounded-md border border-dashed border-border-strong px-4 py-3 text-left opacity-80" aria-label={t('common:emptyState.demoRow')}>
          <span className="absolute -top-2.5 left-3 bg-background px-1.5 text-xs text-text-3">{t('common:emptyState.demoRow')}</span>
          {demoRow}
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {kind === 'filtered' && onReset ? (
        <Button variant="outline" className="mt-2" onClick={onReset}>
          {t('common:emptyState.resetFilters')}
        </Button>
      ) : null}
      {kind === 'new' && action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
