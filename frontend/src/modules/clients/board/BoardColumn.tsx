import { useDroppable } from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { StatusDot } from '@/modules/pricing/status-colors'
import type { FilterClause } from '@/shared/lib/filters'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import type { ProspectRow } from '../prospects/types'
import type { ProspectStatusEntry } from '@/shared/lib/types'
import { BoardCard, type MoveTarget } from './BoardCard'
import { Sums } from './Sums'
import type { BoardColumnData } from './types'
import { fetchBoardColumn } from './use-board-data'

export interface ColumnProps {
  column: BoardColumnData
  status: ProspectStatusEntry | undefined
  currency: string
  f: FilterClause[]
  q: string
  draggable: boolean
  moveTargets: MoveTarget[]
  onOpen: (id: string) => void
  onMove: (row: ProspectRow, status: string) => void
}

/** A closed stage (won, lost) as a thin strip: a count and a name, still a place to drop a card. */
export function FoldedColumn({ column, status, onExpand }: { column: BoardColumnData; status: ProspectStatusEntry | undefined; onExpand: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status })
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={t('clients:board.expand', { label: column.label })}
      aria-label={t('clients:board.expand', { label: column.label })}
      onClick={onExpand}
      className={cn(
        'flex w-10 flex-col items-center gap-2 rounded-md bg-muted/50 py-3 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isOver && 'bg-accent',
      )}
    >
      {status ? <StatusDot token={status.colorToken} /> : null}
      <span className="font-medium tabular-nums">{formatNumber(column.count)}</span>
      <span className="[writing-mode:vertical-rl] truncate text-muted-foreground">{column.label}</span>
    </button>
  )
}

export function BoardColumn({ column, status, currency, f, q, draggable, moveTargets, onOpen, onMove }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status })
  const [extra, setExtra] = useState<ProspectRow[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // Pages past the first belong to the data they were loaded with: a refetch starts the column over.
  const firstIds = column.cards.map((card) => card.id).join(',')
  useEffect(() => {
    setExtra([])
    setPage(1)
    setFailed(false)
  }, [firstIds, f, q])

  const seen = new Set(column.cards.map((card) => card.id))
  const cards = [...column.cards, ...extra.filter((card) => !seen.has(card.id))]
  const remaining = column.count - cards.length

  const loadMore = () => {
    setLoading(true)
    setFailed(false)
    fetchBoardColumn(f, q, column.status, page + 1)
      .then((res) => {
        setExtra((old) => [...old, ...res.cards])
        setPage((old) => old + 1)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  return (
    <section ref={setNodeRef} aria-label={column.label} className={cn('flex min-w-0 flex-col rounded-md bg-muted/40 p-2', isOver && 'bg-accent')}>
      <header className="space-y-1 px-1 pb-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {status ? <StatusDot token={status.colorToken} /> : null}
          <span className="min-w-0 truncate">{column.label}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{formatNumber(column.count)}</span>
        </h3>
        <Sums sums={column.sums} equivalent={column.sumInCompanyCurrency} companyCurrency={currency} />
      </header>
      <div className="space-y-2">
        {cards.length === 0 ? <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t('clients:board.emptyColumn')}</p> : null}
        {cards.map((row) => (
          <BoardCard key={row.id} row={row} currency={currency} draggable={draggable && row.canEdit} moveTargets={moveTargets} onOpen={onOpen} onMove={onMove} />
        ))}
        {remaining > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="w-full" disabled={loading} onClick={loadMore}>
            {failed ? t('clients:board.loadMoreFailed') : t('clients:board.loadMore', { count: remaining, n: formatNumber(remaining) })}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
