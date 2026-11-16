import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

export interface WidgetAction {
  to: string
  label: string
}

interface WidgetFrameProps {
  title: string
  /** The module the data comes from, in small text next to the title. */
  module: string
  /** One action per widget (DESIGN.md), as a link at the bottom. */
  action?: WidgetAction
  /** `dataUpdatedAt` of the main query: the widget says how old its figures are. */
  updatedAt?: number
  state: 'loading' | 'ready' | 'empty' | 'error'
  /** The sentence of the empty state; the frame keeps its height, with a dotted outline. */
  emptyText?: string
  onRetry?: () => void
  /** In the catalog the widget is a live preview: links do nothing. */
  preview?: boolean
  children?: ReactNode
  className?: string
}

/** "Actualizat acum 2 min", refreshed every half minute so the age stays honest. */
function Age({ at }: { at: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="widget-age truncate text-xs text-text-3">{t('overview:widgets.updated', { when: formatRelativeTime(at) })}</span>
}

export function WidgetFrame({ title, module, action, updatedAt, state, emptyText, onRetry, preview, children, className }: WidgetFrameProps) {
  const footer = (
    <div className="mt-auto flex min-w-0 items-center justify-between gap-3 pt-3">
      {action ? (
        <Link
          to={action.to}
          tabIndex={preview ? -1 : undefined}
          className="truncate rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {action.label}
        </Link>
      ) : (
        <span />
      )}
      {updatedAt && state === 'ready' ? <Age at={updatedAt} /> : null}
    </div>
  )

  return (
    <section
      aria-label={title}
      className={cn(
        'widget-frame flex h-full min-h-0 min-w-0 flex-col rounded-lg p-4',
        state === 'empty' ? 'border border-dashed border-border-strong' : 'border bg-card',
        className,
      )}
    >
      <header className="flex min-w-0 items-baseline gap-2">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        <span className="shrink-0 truncate text-xs text-text-3">{module}</span>
      </header>
      <div className="mt-3 min-h-0 flex-1 overflow-hidden">
        {state === 'loading' ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : state === 'error' ? (
          <div className="space-y-2">
            <p className="text-sm">{t('overview:widgets.failed')}</p>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                {t('common:actions.retry')}
              </Button>
            ) : null}
          </div>
        ) : state === 'empty' ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          children
        )}
      </div>
      {footer}
    </section>
  )
}

/** The state of a widget from its main query, so every widget decides the same way. */
export function widgetState(query: { isPending: boolean; isError: boolean }, empty: boolean): WidgetFrameProps['state'] {
  if (query.isPending) return 'loading'
  if (query.isError) return 'error'
  return empty ? 'empty' : 'ready'
}
