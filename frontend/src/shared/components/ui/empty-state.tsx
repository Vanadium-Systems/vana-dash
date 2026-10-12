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
}

export function EmptyState({ kind, title, description, action, onReset, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-10 text-center', className)}>
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
