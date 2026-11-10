import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useRef, useState, type TouchEvent } from 'react'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import type { FilterClause } from '@/shared/lib/filters'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import type { ProspectRow } from '../prospects/types'
import type { ProspectStatusEntry } from '@/shared/lib/types'
import { CardGhost, type MoveTarget } from './BoardCard'
import { BoardColumn, FoldedColumn } from './BoardColumn'
import type { BoardResponse } from './types'

const SWIPE_MIN_PX = 48

/**
 * The prospect list as stage columns. From 1024px all open stages sit side by side and cards can be
 * dragged; narrower, one stage shows at a time (swipe or the stage buttons) and the card menu moves cards.
 */
export function ProspectBoard({
  board,
  statuses,
  currency,
  f,
  q,
  onOpen,
  onMove,
}: {
  board: BoardResponse
  statuses: ProspectStatusEntry[]
  currency: string
  f: FilterClause[]
  q: string
  onOpen: (id: string) => void
  onMove: (row: ProspectRow, status: string) => void
}) {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [expanded, setExpanded] = useState<string[]>([])
  const [shown, setShown] = useState('')
  const [dragging, setDragging] = useState<ProspectRow | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  // A small distance / delay so a click on the name or the menu is never taken for a drag, and a touch can still scroll.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }))

  const statusOf = (key: string) => statuses.find((entry) => entry.key === key)
  const moveTargets: MoveTarget[] = board.columns.map((col) => ({ status: col.status, label: col.label }))
  const columnProps = { currency, f, q, draggable: wide, moveTargets, onOpen, onMove }

  if (board.columns.length === 0) return <EmptyState kind="new" title={t('clients:board.noStages')} />

  const onDragStart = (event: DragStartEvent) => setDragging((event.active.data.current as { row: ProspectRow } | undefined)?.row ?? null)
  const onDragEnd = (event: DragEndEvent) => {
    const row = (event.active.data.current as { row: ProspectRow } | undefined)?.row
    setDragging(null)
    if (row && event.over && event.over.id !== row.status) onMove(row, String(event.over.id))
  }

  if (wide) {
    const open = (col: BoardResponse['columns'][number]) => col.kind === 'open' || expanded.includes(col.status)
    return (
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="flex items-start gap-2">
          {board.columns.map((col) =>
            open(col) ? (
              <div key={col.status} className="min-w-0 flex-1 basis-0">
                <BoardColumn column={col} status={statusOf(col.status)} {...columnProps} />
              </div>
            ) : (
              <FoldedColumn key={col.status} column={col} status={statusOf(col.status)} onExpand={() => setExpanded((old) => [...old, col.status])} />
            ),
          )}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <CardGhost row={dragging} currency={currency} /> : null}</DragOverlay>
      </DndContext>
    )
  }

  const index = Math.max(0, board.columns.findIndex((col) => col.status === shown))
  const current = board.columns[index]!
  const go = (step: number) => setShown(board.columns[Math.min(board.columns.length - 1, Math.max(0, index + step))]!.status)
  const onTouchStart = (e: TouchEvent) => {
    const point = e.touches[0]
    touchStart.current = point ? { x: point.clientX, y: point.clientY } : null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current
    const end = e.changedTouches[0]
    touchStart.current = null
    if (!start || !end) return
    const dx = end.clientX - start.x
    // Mostly sideways only: a vertical scroll that drifts a little must not change the stage.
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(end.clientY - start.y) * 1.5) go(dx < 0 ? 1 : -1)
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('clients:board.stagePicker')} className="flex flex-wrap gap-1.5">
        {board.columns.map((col) => (
          <button
            key={col.status}
            type="button"
            aria-pressed={col.status === current.status}
            onClick={() => setShown(col.status)}
            className={cn(
              'inline-flex h-control-sm items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              col.status === current.status ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {col.label} <span className="tabular-nums">{formatNumber(col.count)}</span>
          </button>
        ))}
      </div>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-h-40">
        <DndContext sensors={sensors}>
          <BoardColumn key={current.status} column={current} status={statusOf(current.status)} {...columnProps} />
        </DndContext>
      </div>
      <p className="text-center text-xs text-muted-foreground">{t('clients:board.swipeHint', { n: index + 1, total: board.columns.length })}</p>
    </div>
  )
}

export function BoardSkeleton() {
  return <ListSkeleton rows={6} />
}
