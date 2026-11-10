import { useState } from 'react'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import type { FunnelStage } from './use-report-data'

/** "89% · −11%": how many of the previous stage got here, and how many dropped on the way. */
export function conversionText(stage: FunnelStage): string {
  if (stage.conversionFromPrevious === null) return t('clients:reports.funnel.first')
  const kept = Math.round(stage.conversionFromPrevious * 100)
  return t('clients:reports.funnel.conversion', { kept: formatNumber(kept, '%'), lost: formatNumber(100 - kept, '%') })
}

/**
 * Stages as bars. The chosen one is at full contrast and the rest are muted, so the figure under
 * the chart is about the bar that stands out. Vertical from 640px; on a phone the bars lie down,
 * because eight stage names do not fit side by side at 360px.
 */
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const vertical = useMediaQuery('(min-width: 640px)')
  const [chosen, setChosen] = useState<string | null>(null)
  const top = Math.max(1, ...stages.map((stage) => stage.reached))
  const picked = stages.find((stage) => stage.status === chosen)

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('clients:reports.funnel.title')} className={vertical ? 'flex h-56 items-end gap-2' : 'space-y-2'}>
        {stages.map((stage) => {
          const share = (stage.reached / top) * 100
          const muted = chosen !== null && chosen !== stage.status
          const label = `${stage.label}: ${formatNumber(stage.reached)} (${conversionText(stage)})`
          return (
              <button
                key={stage.status}
                type="button"
                title={conversionText(stage)}
                aria-pressed={chosen === stage.status}
                aria-label={label}
                onClick={() => setChosen(chosen === stage.status ? null : stage.status)}
                className={cn(
                  'min-w-0 rounded-sm text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  vertical ? 'flex h-full flex-1 flex-col justify-end gap-1.5' : 'grid w-full grid-cols-[6rem_1fr_3rem] items-center gap-2 text-left',
                )}
              >
                {vertical ? (
                  <>
                    <span className="text-center font-medium tabular-nums">{formatNumber(stage.reached)}</span>
                    <span aria-hidden="true" className={cn('block w-full rounded-t-sm', muted ? 'bg-primary/25' : 'bg-primary')} style={{ height: `${Math.max(share, 1)}%` }} />
                    <span className="block truncate text-center text-muted-foreground">{stage.label}</span>
                  </>
                ) : (
                  <>
                    <span className="truncate text-muted-foreground">{stage.label}</span>
                    <span aria-hidden="true" className="block h-3 rounded-sm bg-muted">
                      <span className={cn('block h-full rounded-sm', muted ? 'bg-primary/25' : 'bg-primary')} style={{ width: `${Math.max(share, 1)}%` }} />
                    </span>
                    <span className="text-right font-medium tabular-nums">{formatNumber(stage.reached)}</span>
                  </>
                )}
              </button>
          )
        })}
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {picked ? `${picked.label}: ${formatNumber(picked.reached)} · ${conversionText(picked)}` : t('clients:reports.funnel.hint')}
      </p>
    </div>
  )
}
