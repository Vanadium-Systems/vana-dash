import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { serializeClauses, type FilterClause } from '@/shared/lib/filters'
import { formatNumber, formatRelativeTime } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { MergeView } from './MergeView'
import type { DuplicateReason, HealthCounts } from './types'
import { useDuplicates, useHealth } from './use-health'

type CountKey = Exclude<keyof HealthCounts, 'lastCheckedAt'>

// The filters the prospect list applies when a card is clicked; the server counts with the same rules.
const CARD_FILTERS: Record<Exclude<CountKey, 'duplicates'>, FilterClause[]> = {
  withoutPhone: [{ field: 'phone', op: 'is_empty' }],
  withoutEmail: [{ field: 'email', op: 'is_empty' }],
  invalidOrBounced: [{ field: 'contactStatus', op: 'in', value: ['invalid', 'bounced'] }],
  struckOff: [{ field: 'isActive', op: 'in', value: ['false'] }],
}

const CARD_TEXTS: Record<CountKey, TKey> = {
  withoutPhone: 'clients:health.cards.withoutPhone',
  withoutEmail: 'clients:health.cards.withoutEmail',
  invalidOrBounced: 'clients:health.cards.invalidOrBounced',
  struckOff: 'clients:health.cards.struckOff',
  duplicates: 'clients:health.cards.duplicates',
}

const REASON_TEXTS: Record<DuplicateReason, TKey> = {
  cif: 'clients:health.reasons.cif',
  phone: 'clients:health.reasons.phone',
  email: 'clients:health.reasons.email',
  name: 'clients:health.reasons.name',
}

function CountCard({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        count === 0 ? 'cursor-default text-muted-foreground' : 'hover:bg-accent',
      )}
    >
      <span className="text-2xl font-semibold tabular-nums">{formatNumber(count)}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </button>
  )
}

function Duplicates({ onMerge }: { onMerge: (masterId: string, otherId: string) => void }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const duplicates = useDuplicates(page, pageSize)

  if (duplicates.isPending) return <ListSkeleton />
  if (duplicates.isError) return <EmptyState kind="filtered" title={t('clients:health.loadFailed')} onReset={() => void duplicates.refetch()} />
  const { items, total, checkedAt } = duplicates.data
  if (total === 0) return <EmptyState kind="new" title={checkedAt ? t('clients:health.noDuplicatesAt', { when: formatRelativeTime(checkedAt) }) : t('clients:health.noDuplicates')} />

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('clients:health.pair')}</TableHead>
            <TableHead priority="md">{t('clients:health.reason')}</TableHead>
            <TableHead className="w-28">
              <span className="sr-only">{t('common:labels.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((pair) => {
            const reasons = pair.reasons.map((reason) => t(REASON_TEXTS[reason]))
            return (
              <TableRow key={`${pair.a.id}-${pair.b.id}`}>
                <TableCell className="tbl-fill">
                  <span className="block max-w-full truncate font-medium">{pair.a.name}</span>
                  <span className="block max-w-full truncate text-muted-foreground">{pair.b.name}</span>
                  <TableDetails items={[reasons.join(', ')]} />
                </TableCell>
                <TableCell priority="md">
                  <span className="flex flex-wrap gap-1">
                    {reasons.map((reason) => (
                      <Badge key={reason} variant="secondary">
                        {reason}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell>
                  {pair.canMerge ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onMerge(pair.a.id, pair.b.id)}>
                      {t('clients:health.merge.action')}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('clients:health.notYours')}</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <TablePagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(0) }} />
    </>
  )
}

/** The tab "Sănătate": counts that open the list filtered, and the pairs that look like one company. */
export function HealthTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const health = useHealth()
  const pairs = useRef<HTMLElement>(null)
  const master = searchParams.get('master')
  const other = searchParams.get('other')

  if (master && other) {
    return <MergeView masterId={master} otherId={other} onSwap={() => setSearchParams({ tab: 'sanatate', master: other, other: master }, { replace: true })} onClose={() => setSearchParams({ tab: 'sanatate' })} />
  }

  const showInList = (key: keyof typeof CARD_FILTERS) => setSearchParams({ f: serializeClauses(CARD_FILTERS[key]) })

  if (health.isPending) return <ListSkeleton />
  if (health.isError) return <EmptyState kind="filtered" title={t('clients:health.loadFailed')} onReset={() => void health.refetch()} />
  const counts = health.data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 min-[30rem]:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(CARD_FILTERS) as Array<keyof typeof CARD_FILTERS>).map((key) => (
          <CountCard key={key} label={t(CARD_TEXTS[key])} count={counts[key]} onClick={() => showInList(key)} />
        ))}
        <CountCard label={t(CARD_TEXTS.duplicates)} count={counts.duplicates} onClick={() => pairs.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      </div>
      <p className="text-xs text-muted-foreground">{counts.lastCheckedAt ? t('clients:health.checkedAt', { when: formatRelativeTime(counts.lastCheckedAt) }) : t('clients:health.neverChecked')}</p>
      <section ref={pairs} className="scroll-mt-4 space-y-3">
        <h2 className="text-sm font-semibold">{t('clients:health.duplicates')}</h2>
        <Card>
          <CardContent className="pt-6">
            <Duplicates onMerge={(masterId, otherId) => setSearchParams({ tab: 'sanatate', master: masterId, other: otherId })} />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
