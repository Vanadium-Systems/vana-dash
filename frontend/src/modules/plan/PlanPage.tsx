import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, GripVertical, Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import type { PlanGoal, PlanResponse, PlanScope } from '@/shared/lib/types'
import { PlanGoalFormDialog } from './PlanGoalFormDialog'
import { tierLabel } from './tiers'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

const SCOPES = [
  { key: 'personal', label: t('common:labels.personal') },
  { key: 'firma', label: t('common:labels.company') },
] as const

const STATUS_STYLES: Record<PlanGoal['status'], string> = {
  locked: 'border-muted bg-muted/30 text-muted-foreground',
  available: 'border-primary bg-primary/5',
  completed: 'border-success/40 bg-success/5',
}

function StatusIcon({ status }: { status: PlanGoal['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 text-success" />
  if (status === 'available') return <Circle className="h-5 w-5 text-primary" />
  return <Lock className="h-5 w-5 text-muted-foreground" />
}

function formatRon(value: number): string {
  return value.toLocaleString(intlTag())
}

function formatTargetDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short', year: 'numeric' })
}

function GoalRow({ goal, mrrRon, onEdit }: { goal: PlanGoal; mrrRon: number; onEdit: (goal: PlanGoal) => void }) {
  const queryClient = useQueryClient()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id })

  const toggleComplete = useMutation({
    mutationFn: (completed: boolean) => api.patch<PlanGoal>(`/api/plan/${goal.id}/complete`, { completed }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plan'] }),
    onError: (err) => toast.error(err.message),
  })

  const thresholdValue = goal.thresholdValue ? Number(goal.thresholdValue) : null
  const progressPct = thresholdValue ? Math.min(100, (mrrRon / thresholdValue) * 100) : null
  const monthlyCost = goal.monthlyCostRon ? Number(goal.monthlyCostRon) : null
  const targetPrice = goal.targetPriceAmount ? Number(goal.targetPriceAmount) : null

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-lg border p-4 transition-colors',
        STATUS_STYLES[goal.status],
        isDragging ? 'opacity-50' : '',
      )}
    >
      <button
        type="button"
        className="mt-1 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="mt-0.5">
        <StatusIcon status={goal.status} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('font-medium', goal.status === 'completed' ? 'line-through decoration-success' : '')}>
            {goal.title}
          </span>
          {goal.thresholdType === 'mrr_ron' ? <Badge variant="outline">{t('plan:mrrThresholdTag')}</Badge> : null}
          {monthlyCost !== null ? <Badge variant="outline">{t('plan:perMonth', { amount: `${formatRon(monthlyCost)} RON` })}</Badge> : null}
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
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('plan:mrrProgress', { current: formatRon(mrrRon), target: `${formatRon(thresholdValue!)} RON` })}
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex w-full shrink-0 justify-end gap-1 sm:w-auto">
        <Button
          variant="outline"
          disabled={toggleComplete.isPending}
          onClick={() => toggleComplete.mutate(goal.status !== 'completed')}
        >
          {goal.status === 'completed' ? t('common:actions.cancel') : t('plan:markDone')}
        </Button>
        <Button variant="outline" onClick={() => onEdit(goal)}>
          {t('common:actions.edit')}
        </Button>
      </div>
    </div>
  )
}

/** Listă drag-and-drop pt. un singur (scope, tier) — reorder-ul e strict scoped la acest set. */
function GoalList({
  scope,
  tier,
  goals,
  mrrRon,
  onEdit,
}: {
  scope: PlanScope
  tier: number
  goals: PlanGoal[]
  mrrRon: number
  onEdit: (goal: PlanGoal) => void
}) {
  const queryClient = useQueryClient()

  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.post<PlanGoal[]>('/api/plan/reorder', { scope, tier, orderedIds }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plan'] }),
    onError: (err) => {
      toast.error(err.message)
      void queryClient.invalidateQueries({ queryKey: ['plan'] })
    },
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = goals.findIndex((g) => g.id === active.id)
    const newIndex = goals.findIndex((g) => g.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const nextOrder = arrayMove(goals, oldIndex, newIndex).map((g) => g.id)
    const positionById = new Map(nextOrder.map((id, i) => [id, i + 1]))

    queryClient.setQueryData<PlanResponse | undefined>(['plan'], (current) => {
      if (!current) return current
      const updated = current[scope].map((g) => (positionById.has(g.id) ? { ...g, position: positionById.get(g.id)! } : g))
      return { ...current, [scope]: updated }
    })
    reorder.mutate(nextOrder)
  }

  if (!goals.length) return <p className="text-sm text-muted-foreground">{t('plan:emptyTrack')}</p>

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={goals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {goals.map((goal) => (
            <GoalRow key={goal.id} goal={goal} mrrRon={mrrRon} onEdit={onEdit} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function groupByTier(goals: PlanGoal[]): [number, PlanGoal[]][] {
  const byTier = new Map<number, PlanGoal[]>()
  for (const goal of goals) {
    const bucket = byTier.get(goal.tier)
    if (bucket) bucket.push(goal)
    else byTier.set(goal.tier, [goal])
  }
  for (const bucket of byTier.values()) bucket.sort((a, b) => a.position - b.position)
  return [...byTier.entries()].sort(([a], [b]) => a - b)
}

function sumMonthlyCost(goals: PlanGoal[]): number {
  return goals.reduce((sum, g) => sum + (g.monthlyCostRon ? Number(g.monthlyCostRon) : 0), 0)
}

/** Pista "firma" — grupată pe etaje (tycoon), fiecare etaj cu propriul drag-and-drop și cost lunar. */
function TieredGoals({ goals, mrrRon, onEdit }: { goals: PlanGoal[]; mrrRon: number; onEdit: (goal: PlanGoal) => void }) {
  const tiers = groupByTier(goals)
  const totalMonthlyCost = sumMonthlyCost(goals)
  const gap = totalMonthlyCost - mrrRon

  let cumulative = 0
  const tiersWithCumulative = tiers.map(([tier, tierGoals]) => {
    const tierCost = sumMonthlyCost(tierGoals)
    cumulative += tierCost
    return { tier, tierGoals, tierCost, cumulativeCost: cumulative }
  })

  return (
    <div className="space-y-4">
      {totalMonthlyCost > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4 text-sm">
            <span className="text-muted-foreground">
              {tNodes('plan:totalVsMrr', {
                cost: <span className="font-medium text-foreground">{formatRon(totalMonthlyCost)} RON</span>,
                mrr: <span className="font-medium text-foreground">{formatRon(mrrRon)} RON</span>,
              })}
            </span>
            <Badge variant={gap > 0 ? 'warning' : 'success'}>
              {gap > 0 ? t('plan:gap', { amount: `${formatRon(gap)} RON` }) : t('plan:coveredByMrr')}
            </Badge>
          </CardContent>
        </Card>
      ) : null}

      {tiersWithCumulative.map(({ tier, tierGoals, tierCost, cumulativeCost }) => {
        const cumulativeGap = cumulativeCost - mrrRon
        return (
          <Card key={tier}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base">{tierLabel(tier)}</CardTitle>
              {tierCost > 0 ? (
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">{t('plan:perMonth', { amount: `${formatRon(tierCost)} RON` })}</Badge>
                  <Badge variant={cumulativeGap > 0 ? 'warning' : 'success'}>
                    {cumulativeGap > 0 ? t('plan:cumulativeGap', { amount: `${formatRon(cumulativeGap)} RON` }) : t('plan:coveredByMrr')}
                  </Badge>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              <GoalList scope="firma" tier={tier} goals={tierGoals} mrrRon={mrrRon} onEdit={onEdit} />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function PlanPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = (searchParams.get('scope') as PlanScope) ?? 'personal'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<PlanGoal | null>(null)

  const plan = useQuery({
    queryKey: ['plan'],
    queryFn: () => api.get<PlanResponse>('/api/plan'),
  })

  const mrrRon = plan.data?.mrrRon ?? 0

  const setScope = (key: PlanScope) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'personal') next.delete('scope')
    else next.set('scope', key)
    setSearchParams(next)
  }

  const openCreate = () => {
    setEditingGoal(null)
    setDialogOpen(true)
  }
  const openEdit = (goal: PlanGoal) => {
    setEditingGoal(goal)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.plan')}
        description={t('plan:description')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t('plan:step.new')}
          </Button>
        }
      />

      <Tabs value={scope} onValueChange={(v) => setScope(v as PlanScope)}>
        <TabsList>
          {SCOPES.map((s) => (
            <TabsTrigger key={s.key} value={s.key}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="personal">
          {plan.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <GoalList scope="personal" tier={1} goals={plan.data?.personal ?? []} mrrRon={mrrRon} onEdit={openEdit} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="firma">
          {plan.isPending ? <Skeleton className="h-32 w-full" /> : <TieredGoals goals={plan.data?.firma ?? []} mrrRon={mrrRon} onEdit={openEdit} />}
        </TabsContent>
      </Tabs>

      <PlanGoalFormDialog open={dialogOpen} onOpenChange={setDialogOpen} goal={editingGoal} scope={scope} />
    </div>
  )
}
