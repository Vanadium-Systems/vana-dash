import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { AgentStats } from './use-report-data'

const NUMBER = 'text-right tabular-nums'

/** Alphabetical, as the server sends it: there is deliberately no ranking, only each person's own numbers. */
export function AgentStatsTable({ rows, loading, error, onRetry }: { rows: AgentStats[] | undefined; loading: boolean; error: boolean; onRetry: () => void }) {
  if (loading) return <ListSkeleton rows={4} />
  if (error) return <EmptyState kind="filtered" title={t('clients:reports.loadFailed')} onReset={onRetry} />
  if (!rows || rows.length === 0) return <EmptyState kind="new" title={t('clients:reports.agents.empty')} />
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('clients:reports.agents.agent')}</TableHead>
          <TableHead className={NUMBER}>{t('clients:reports.agents.claimed')}</TableHead>
          <TableHead priority="md" className={NUMBER}>
            {t('clients:reports.agents.contactedToday')}
          </TableHead>
          <TableHead className={NUMBER}>{t('clients:reports.agents.withoutNextStep')}</TableHead>
          <TableHead priority="md" className={NUMBER}>
            {t('clients:reports.agents.won')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.userId}>
            <TableCell className="tbl-fill">
              <div className="truncate font-medium">{row.name}</div>
              <TableDetails
                items={[
                  `${t('clients:reports.agents.contactedToday')}: ${formatNumber(row.contactedToday)}`,
                  `${t('clients:reports.agents.won')}: ${formatNumber(row.won)}`,
                ]}
              />
            </TableCell>
            <TableCell className={NUMBER}>{formatNumber(row.claimed)}</TableCell>
            <TableCell priority="md" className={NUMBER}>
              {formatNumber(row.contactedToday)}
            </TableCell>
            <TableCell className={NUMBER}>{formatNumber(row.withoutNextStep)}</TableCell>
            <TableCell priority="md" className={NUMBER}>
              {formatNumber(row.won)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
