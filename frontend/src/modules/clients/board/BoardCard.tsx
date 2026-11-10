import { useDraggable } from '@dnd-kit/core'
import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Initials } from '../sheet/SheetHeader'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { formatMoney, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { isOverdue } from '../prospects/cells'
import type { ProspectRow } from '../prospects/types'

export interface MoveTarget {
  status: string
  label: string
}

function CardFace({ row, currency, onOpen, menu }: { row: ProspectRow; currency: string; onOpen: (id: string) => void; menu?: ReactNode }) {
  const task = row.nextTask
  return (
    <>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-sm text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpen(row.id)}
        >
          <span className="line-clamp-2 break-words">{row.name}</span>
        </button>
        {menu}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        {row.ownerName ? <Initials name={row.ownerName} /> : <span>{t('clients:sheet.header.free')}</span>}
        {row.valueAmount !== null ? <span className="ml-auto truncate font-medium tabular-nums text-foreground">{formatMoney(Number(row.valueAmount), row.valueCurrency ?? currency, { decimals: 0 })}</span> : null}
      </div>
      <p className={cn('mt-1.5 truncate text-xs', task ? (isOverdue(task) ? 'text-warning-text' : 'text-muted-foreground') : 'text-warning-text')}>
        {task ? `${task.title} · ${formatRelativeTime(task.dueAt)}` : t('clients:board.noNextStep')}
      </p>
      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{t('clients:prospects.days', { count: row.daysInStage })}</p>
    </>
  )
}

/** The card as it follows the pointer: no state, nothing to click. */
export function CardGhost({ row, currency }: { row: ProspectRow; currency: string }) {
  return (
    <div className="cursor-grabbing rounded-md border bg-card p-3 shadow-md">
      <CardFace row={row} currency={currency} onOpen={() => undefined} />
    </div>
  )
}

export function BoardCard({
  row,
  currency,
  draggable,
  moveTargets,
  onOpen,
  onMove,
}: {
  row: ProspectRow
  currency: string
  /** Pointer drag between columns; false on a phone (one column) and for rows the person cannot edit. */
  draggable: boolean
  moveTargets: MoveTarget[]
  onOpen: (id: string) => void
  onMove: (row: ProspectRow, status: string) => void
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: row.id, disabled: !draggable, data: { row } })
  // Without the menu a card nobody may edit would look movable; the menu is also the keyboard and phone route.
  const menu = row.canEdit ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('clients:board.moveAria', { name: row.name })}
        className="-mr-1 inline-flex size-control-sm shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={t('clients:board.move')} align="end">
        {moveTargets
          .filter((target) => target.status !== row.status)
          .map((target) => (
            <DropdownMenuItem key={target.status} onClick={() => onMove(row, target.status)}>
              {target.label}
            </DropdownMenuItem>
          ))}
      </ResponsiveMenuContent>
    </DropdownMenu>
  ) : undefined
  return (
    <div
      ref={setNodeRef}
      // Only the pointer listeners: dnd-kit's role and tabIndex would nest a button around the name and the menu.
      {...(draggable ? listeners : {})}
      className={cn('rounded-md border bg-card p-3', draggable && 'cursor-grab', isDragging && 'opacity-40')}
    >
      <CardFace row={row} currency={currency} onOpen={onOpen} menu={menu} />
    </div>
  )
}
