import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, GripVertical, Lock } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { api } from '@/shared/lib/api'
import { formatDate, intlTag } from '@/shared/lib/format'
import { haptic } from '@/shared/lib/haptics'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import { motionLevel } from '@/shared/lib/motion'
import type { PlanGoal, PlanResponse, PlanScope } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { moveAcrossTiers, settleDrop, tierDropId, type TierItems } from './plan-board'

const STATUS_STYLES: Record<PlanGoal['status'], string> = {
  locked: 'border-muted bg-muted/30 text-muted-foreground',
  available: 'border-primary bg-primary/5',
  completed: 'border-success/40 bg-success/5',
}

export function formatRon(value: number): string {
  return value.toLocaleString(intlTag())
}

// Noon UTC, so a date-only string lands on the same calendar day in any time zone.
function formatTargetDate(value: string): string {
  return formatDate(new Date(`${value}T12:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function StatusIcon({ status }: { status: PlanGoal['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 text-success" />
  if (status === 'available') return <Circle className="h-5 w-5 text-primary" />
  return <Lock className="h-5 w-5 text-muted-foreground" />
}

// The handle is for a mouse: it shows on hover and on keyboard focus. On a phone it is not drawn;
// a long press on the row picks the goal up instead.
const HANDLE_CLASS =
  'mt-1 hidden cursor-grab touch-none rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing [@media(hover:hover)_and_(pointer:fine)]:inline-flex [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100'

interface GoalCardProps {
  goal: PlanGoal
  mrrRon: number
  onEdit: (goal: PlanGoal) => void
  /** Props for the drag handle; absent in the drag overlay. */
  handle?: Record<string, unknown>
}

function GoalCard({ goal, mrrRon, onEdit, handle }: GoalCardProps) {
  const queryClient = useQueryClient()
  const toggleComplete = useMutation({
    mutationFn: (completed: boolean) => api.patch<PlanGoal>(`/api/plan/${goal.id}/complete`, { completed }),
    onSuccess: (_goal, completed) => {
      if (completed) void haptic('success')
      void queryClient.invalidateQueries({ queryKey: ['plan'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const thresholdValue = goal.thresholdValue ? Number(goal.thresholdValue) : null
  const progressPct = thresholdValue ? Math.min(100, (mrrRon / thresholdValue) * 100) : null
  const monthlyCost = goal.monthlyCostRon ? Number(goal.monthlyCostRon) : null
  const targetPrice = goal.targetPriceAmount ? Number(goal.targetPriceAmount) : null

  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-lg border p-4', STATUS_STYLES[goal.status])}>
      <button type="button" className={HANDLE_CLASS} aria-label={t('plan:dnd.handle', { title: goal.title })} title={t('plan:dnd.handle', { title: goal.title })} {...handle}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="mt-0.5">
        <StatusIcon status={goal.status} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('font-medium', goal.status === 'completed' ? 'line-through decoration-success' : '')}>{goal.title}</span>
          {goal.thresholdType === 'mrr_ron' ? <Badge variant="outline">{t('plan:mrrThresholdTag')}</Badge> : null}
          {monthlyCost !== null ? <Badge variant="outline">{t('plan:perMonth', { amount: `${formatRon(monthlyCost)} ${BASE_CURRENCY}` })}</Badge> : null}
          {targetPrice !== null ? (
            <Badge variant="outline">
              {formatRon(targetPrice)} {goal.targetPriceCurrency}
            </Badge>
          ) : null}
          {goal.targetDate ? (
            <Badge variant={goal.status !== 'completed' && goal.targetDate < new Date().toISOString().slice(0, 10) ? 'warning' : 'outline'}>
              {t('plan:deadline', { targetDate: formatTargetDate(goal.targetDate) })}
            </Badge>
          ) : null}
        </div>
        {goal.note ? <p className="text-sm text-muted-foreground">{goal.note}</p> : null}
        {progressPct !== null ? (
          <div className="space-y-1 pt-1">
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
              <div className="h-full origin-left bg-primary transition-transform duration-screen ease-out-strong" style={{ transform: `scaleX(${progressPct / 100})` }} />
            </div>
            <p className="text-xs text-muted-foreground">{t('plan:mrrProgress', { current: formatRon(mrrRon), target: `${formatRon(thresholdValue!)} ${BASE_CURRENCY}` })}</p>
          </div>
        ) : null}
      </div>
      <div className="flex w-full shrink-0 justify-end gap-1 sm:w-auto">
        <Button variant="outline" disabled={toggleComplete.isPending} onClick={() => toggleComplete.mutate(goal.status !== 'completed')}>
          {goal.status === 'completed' ? t('common:actions.cancel') : t('plan:markDone')}
        </Button>
        <Button variant="outline" onClick={() => onEdit(goal)}>
          {t('common:actions.edit')}
        </Button>
      </div>
    </div>
  )
}

function SortableGoal({ goal, mrrRon, onEdit }: Omit<GoalCardProps, 'handle'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: motionLevel() === 'full' ? transition : undefined }}
      className={cn('group', isDragging && 'opacity-40')}
      // Touch: the row itself starts the drag, after a long press (the sensor's delay).
      onTouchStart={listeners?.onTouchStart as React.TouchEventHandler<HTMLDivElement> | undefined}
    >
      <GoalCard goal={goal} mrrRon={mrrRon} onEdit={onEdit} handle={{ ...attributes, ...listeners }} />
    </div>
  )
}

function TierColumn({ tier, ids, goalsById, mrrRon, onEdit, header, emptyIsTier }: { tier: number; ids: string[]; goalsById: Map<string, PlanGoal>; mrrRon: number; onEdit: (goal: PlanGoal) => void; header: ReactNode; emptyIsTier: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: tierDropId(tier) })
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground">
      {header}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={cn('min-h-12 space-y-2 rounded-md', isOver && ids.length === 0 && 'bg-accent/50')}>
          {ids.map((id) => {
            const goal = goalsById.get(id)
            return goal ? <SortableGoal key={id} goal={goal} mrrRon={mrrRon} onEdit={onEdit} /> : null
          })}
          {ids.length === 0 ? <EmptyState kind="new" title={emptyIsTier ? t('plan:emptyTier') : t('plan:emptyTrack')} className="py-4" /> : null}
        </div>
      </SortableContext>
    </section>
  )
}

function buildItems(goals: PlanGoal[], tiers: number[]): TierItems {
  const items: TierItems = Object.fromEntries(tiers.map((tier) => [tier, [] as string[]]))
  for (const goal of [...goals].sort((a, b) => a.position - b.position)) items[goal.tier]?.push(goal.id)
  return items
}

interface PlanBoardProps {
  scope: PlanScope
  goals: PlanGoal[]
  /** The tiers drawn as columns; goals can be dragged between them. */
  tiers: number[]
  mrrRon: number
  onEdit: (goal: PlanGoal) => void
  tierHeader: (tier: number, tierGoals: PlanGoal[]) => ReactNode
}

/** Drag-and-drop over several lists (the company's four tiers) or one (the personal track). */
export function PlanBoard({ scope, goals, tiers, mrrRon, onEdit, tierHeader }: PlanBoardProps) {
  const queryClient = useQueryClient()
  const stored = useMemo(() => buildItems(goals, tiers), [goals, tiers])
  // While dragging, the lists shown are this local copy; it is dropped when the drop is saved.
  const [live, setLive] = useState<TierItems | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const items = live ?? stored
  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals])
  const active = activeId ? goalsById.get(activeId) : undefined

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const settle = useMutation({
    mutationFn: async ({ goalId, tier, position, moved, order }: { goalId: string; tier: number; position: number; moved: boolean; order: string[] }) => {
      if (moved) return api.patch<PlanGoal>(`/api/plan/${goalId}/move`, { tier, position })
      return api.post<PlanGoal[]>('/api/plan/reorder', { scope, tier, orderedIds: order })
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['plan'] }),
    onError: (err) => toast.error(err.message),
  })

  const titleOf = (id: unknown) => goalsById.get(String(id))?.title ?? ''
  const tierName = (id: unknown, current: TierItems) => {
    const key = String(id)
    const tier = key.startsWith('tier-') ? Number(key.slice(5)) : Object.entries(current).find(([, ids]) => ids.includes(key))?.[0]
    return tier === undefined ? '' : t('plan:dnd.tierName', { tier })
  }

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
    setLive(stored)
  }

  const onDragOver = ({ active: dragged, over }: DragOverEvent) => {
    if (!over) return
    setLive((current) => moveAcrossTiers(current ?? stored, String(dragged.id), String(over.id)))
  }

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    const current = live ?? stored
    setActiveId(null)
    const result = over ? settleDrop(current, String(dragged.id), String(over.id)) : null
    const goal = goalsById.get(String(dragged.id))
    if (!result || !goal) {
      setLive(null)
      return
    }
    const order = result.items[result.tier] ?? []
    const moved = goal.tier !== result.tier
    if (!moved && order.join() === (stored[result.tier] ?? []).join()) {
      setLive(null)
      return
    }
    // Show the new order at once; the saved copy replaces it when the server answers.
    const placed = new Map<string, { tier: number; position: number }>()
    for (const [tier, ids] of Object.entries(result.items)) ids.forEach((id, index) => placed.set(id, { tier: Number(tier), position: index + 1 }))
    queryClient.setQueryData<PlanResponse | undefined>(['plan'], (cached) =>
      cached ? { ...cached, [scope]: cached[scope].map((g) => ({ ...g, ...(placed.get(g.id) ?? {}) })) } : cached,
    )
    setLive(null)
    settle.mutate({ goalId: goal.id, tier: result.tier, position: result.position, moved, order })
  }

  const cancel = () => {
    setActiveId(null)
    setLive(null)
  }

  if (scope === 'personal' && goals.length === 0) return <EmptyState kind="new" title={t('plan:emptyTrack')} />

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={cancel}
      accessibility={{
        screenReaderInstructions: { draggable: t('plan:dnd.instructions') },
        announcements: {
          onDragStart: ({ active: a }) => t('plan:dnd.picked', { title: titleOf(a.id) }),
          onDragOver: ({ active: a, over }) => (over ? t('plan:dnd.over', { title: titleOf(a.id), target: tierName(over.id, items) }) : undefined),
          onDragEnd: ({ active: a, over }) => (over ? t('plan:dnd.dropped', { title: titleOf(a.id), target: tierName(over.id, items) }) : t('plan:dnd.cancelled', { title: titleOf(a.id) })),
          onDragCancel: ({ active: a }) => t('plan:dnd.cancelled', { title: titleOf(a.id) }),
        },
      }}
    >
      <div className="space-y-4">
        {tiers.map((tier) => (
          <TierColumn
            key={tier}
            tier={tier}
            ids={items[tier] ?? []}
            goalsById={goalsById}
            mrrRon={mrrRon}
            onEdit={onEdit}
            emptyIsTier={scope === 'firma'}
            header={tierHeader(tier, goals.filter((goal) => goal.tier === tier))}
          />
        ))}
      </div>
      <DragOverlay>{active ? <GoalCard goal={active} mrrRon={mrrRon} onEdit={onEdit} /> : null}</DragOverlay>
    </DndContext>
  )
}
