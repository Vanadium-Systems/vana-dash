import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { OutreachMailboxSummary } from '@/shared/lib/types'
import { StatePill } from '@/shared/components/ui/state-pill'

export function OutreachMailboxesSummary() {
  const summary = useQuery({
    queryKey: ['email', 'outreach-summary'],
    queryFn: () => api.get<OutreachMailboxSummary[]>('/api/email/outreach-summary'),
  })

  if (!summary.data?.length) return null

  const active = summary.data.filter((m) => m.status === 'active')
  const totalRemaining = active.reduce((sum, m) => sum + m.remainingToday, 0)
  const totalCap = active.reduce((sum, m) => sum + m.effectiveCap, 0)

  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
        <span>{t('email:outreachMailboxes.summaryTitle', { count: active.length })}</span>
        <span className="tabular-nums text-muted-foreground">
          {t('email:outreachMailboxes.summaryTotal', { remaining: totalRemaining, cap: totalCap })}
        </span>
      </div>
      {active.length === 0 ? (
        <p className="mt-1 text-destructive-text">{t('email:outreachMailboxes.summaryNoneActive')}</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-2">
          {active.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5 rounded-sm border bg-card px-2 py-0.5">
              <span>{m.address}</span>
              <StatePill tone={m.remainingToday > 0 ? 'success' : 'warning'}>
                <span className="tabular-nums">
                  {t('email:outreachMailboxes.summaryRemaining', { remaining: m.remainingToday, cap: m.effectiveCap })}
                </span>
              </StatePill>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
