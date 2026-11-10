import { useState } from 'react'
import { PeriodSelect, presetRange, type DayRange } from '@/shared/components/PeriodSelect'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { t } from '@/shared/lib/i18n'
import { AgentStatsTable } from './AgentStatsTable'
import { Funnel } from './Funnel'
import { useAgentStats, useFunnel } from './use-report-data'

/** The tab "Rapoarte": the funnel for the chosen period and each agent's numbers. */
export function ReportsTab() {
  const [period, setPeriod] = useState<DayRange>(() => presetRange('thisMonth'))
  // The server wants both ends; an open-ended range ("any time") falls back to this month instead of failing with a 400.
  const [from, to] = period[0] && period[1] ? [period[0], period[1]] : (presetRange('thisMonth') as [string, string])
  const funnel = useFunnel(from, to)
  const agents = useAgentStats(from, to)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('clients:reports.periodHint')}</p>
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('clients:reports.funnel.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {funnel.isPending ? (
            <ListSkeleton rows={4} />
          ) : funnel.isError ? (
            <EmptyState kind="filtered" title={t('clients:reports.loadFailed')} onReset={() => void funnel.refetch()} />
          ) : funnel.data.stages.length === 0 ? (
            <EmptyState kind="new" title={t('clients:reports.funnel.empty')} />
          ) : (
            <Funnel stages={funnel.data.stages} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('clients:reports.agents.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentStatsTable rows={agents.data} loading={agents.isPending} error={agents.isError} onRetry={() => void agents.refetch()} />
        </CardContent>
      </Card>
    </div>
  )
}
