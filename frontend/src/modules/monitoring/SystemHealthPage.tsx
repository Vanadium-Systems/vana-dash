import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { PageHeader } from '@/shared/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Sparkline } from '@/shared/components/charts/Sparkline'
import { ChartEmpty, ChartError, ChartSkeleton } from '@/shared/components/charts/chart-states'
import { SignalTile } from '@/shared/components/SignalTile'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import type { HealthHistoryPoint, HealthSignalsSummary, HostHealthSummary } from '@/shared/lib/types'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

type HealthRange = '1h' | '1d' | '7d'
const RANGES: Array<{ value: HealthRange; label: string }> = [
  { value: '1h', label: t('monitoring:range.lastHour') },
  { value: '1d', label: t('monitoring:range.lastDay') },
  { value: '7d', label: t('monitoring:range.last7Days') },
]

function formatLastSeen(iso: string | null): string {
  if (!iso) return t('monitoring:noSnapshot')
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return t('monitoring:updatedNow')
  if (minutes < 60) return t('monitoring:updatedMinutesAgo', { minutes })
  return t('monitoring:updatedAt', { when: new Date(iso).toLocaleString(intlTag(), { dateStyle: 'short', timeStyle: 'short' }) })
}

function HistoryCard({ history, emptyLabel }: { history: HealthHistoryPoint[]; emptyLabel: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>CPU / RAM / Disk</CardTitle>
      </CardHeader>
      <CardContent>{history.length ? <Sparkline data={history} /> : <ChartEmpty label={emptyLabel} />}</CardContent>
    </Card>
  )
}

function HostSection({ host }: { host: HostHealthSummary }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{host.host}</h2>
        <span className="text-xs text-muted-foreground">{formatLastSeen(host.last_captured_at)}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {host.signals.map((s) => (
          <SignalTile key={s.key} signal={s} />
        ))}
      </div>
      <HistoryCard history={host.history} emptyLabel={t('monitoring:emptyHost')} />
    </section>
  )
}

export function SystemHealthPage() {
  const [range, setRange] = useState<HealthRange>('7d')

  const summary = useQuery({
    queryKey: ['monitoring', 'health-signals', range],
    queryFn: () => api.get<HealthSignalsSummary>(`/api/monitoring/health-signals?range=${range}`),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.server')}
        actions={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  range === r.value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {summary.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ChartSkeleton key={i} height={110} />
          ))}
        </div>
      ) : summary.isError ? (
        <ChartError message={t('monitoring:loadFailed')} />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">dash (VPS)</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {summary.data?.signals.map((s) => <SignalTile key={s.key} signal={s} />)}
            </div>
            <HistoryCard history={summary.data?.history ?? []} emptyLabel={t('monitoring:emptyBackup')} />
          </section>

          {summary.data?.hosts?.map((host) => <HostSection key={host.host} host={host} />)}
        </>
      )}
    </div>
  )
}
