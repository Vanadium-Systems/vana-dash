import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { SidePeek, usePeek } from '@/shared/components/ui/side-peek'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { api } from '@/shared/lib/api'
import type { PlanGoal, PlanResponse, PlanScope } from '@/shared/lib/types'
import { PlanGoalForm, PlanGoalFormDialog } from './PlanGoalFormDialog'
import { PlanBoard, formatRon } from './PlanBoard'
import { tierLabel } from './tiers'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'
import { BASE_CURRENCY } from '@/shared/lib/locale'

const SCOPES = [
  { key: 'personal', label: t('common:labels.personal') },
  { key: 'firma', label: t('common:labels.company') },
] as const

function sumMonthlyCost(goals: PlanGoal[]): number {
  return goals.reduce((sum, g) => sum + (g.monthlyCostRon ? Number(g.monthlyCostRon) : 0), 0)
}

const FIRMA_TIERS = [1, 2, 3, 4]
const PERSONAL_TIERS = [1]

/** The company track: one column per tier with its monthly cost; goals can be dragged between tiers. */
function TieredGoals({ goals, mrrRon, onEdit }: { goals: PlanGoal[]; mrrRon: number; onEdit: (goal: PlanGoal) => void }) {
  const totalMonthlyCost = sumMonthlyCost(goals)
  const gap = totalMonthlyCost - mrrRon

  const cumulativeCostUpTo = (tier: number) => sumMonthlyCost(goals.filter((goal) => goal.tier <= tier))

  return (
    <div className="space-y-4">
      {totalMonthlyCost > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4 text-sm">
            <span className="text-muted-foreground">
              {tNodes('plan:totalVsMrr', {
                cost: <span className="font-medium text-foreground">{formatRon(totalMonthlyCost)} {BASE_CURRENCY}</span>,
                mrr: <span className="font-medium text-foreground">{formatRon(mrrRon)} {BASE_CURRENCY}</span>,
              })}
            </span>
            <Badge variant={gap > 0 ? 'warning' : 'success'}>
              {gap > 0 ? t('plan:gap', { amount: `${formatRon(gap)} ${BASE_CURRENCY}` }) : t('plan:coveredByMrr')}
            </Badge>
          </CardContent>
        </Card>
      ) : null}

      <PlanBoard
        scope="firma"
        goals={goals}
        tiers={FIRMA_TIERS}
        mrrRon={mrrRon}
        onEdit={onEdit}
        tierHeader={(tier, tierGoals) => {
          const tierCost = sumMonthlyCost(tierGoals)
          const cumulativeGap = cumulativeCostUpTo(tier) - mrrRon
          return (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{tierLabel(tier)}</h2>
              {tierCost > 0 ? (
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">{t('plan:perMonth', { amount: `${formatRon(tierCost)} ${BASE_CURRENCY}` })}</Badge>
                  <Badge variant={cumulativeGap > 0 ? 'warning' : 'success'}>
                    {cumulativeGap > 0 ? t('plan:cumulativeGap', { amount: `${formatRon(cumulativeGap)} ${BASE_CURRENCY}` }) : t('plan:coveredByMrr')}
                  </Badge>
                </div>
              ) : null}
            </div>
          )
        }}
      />
    </div>
  )
}

export function PlanPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = (searchParams.get('scope') as PlanScope) ?? 'personal'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [peekId, openPeek, closePeek] = usePeek()

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

  const openEdit = (goal: PlanGoal) => openPeek(goal.id)
  const peekedGoal = peekId ? [...(plan.data?.personal ?? []), ...(plan.data?.firma ?? [])].find((g) => g.id === peekId) : undefined

  return (
    <div className="space-y-6">
      <PageHeader title={t('common:nav.plan')} description={t('plan:description')} />

      <Tabs value={scope} onValueChange={(v) => setScope(v as PlanScope)}>
        {/* The page's action sits on the tabs row, on the right, so the tabs do not move when the page changes (N29). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TabsList variant="segmented">
            {SCOPES.map((s) => (
              <TabsTrigger key={s.key} value={s.key}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button className="ml-auto" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> {t('plan:step.new')}
          </Button>
        </div>
        <TabsContent value="personal">
          {plan.isPending ? (
            <ListSkeleton rows={4} />
          ) : (
            <PlanBoard
              scope="personal"
              goals={plan.data?.personal ?? []}
              tiers={PERSONAL_TIERS}
              mrrRon={mrrRon}
              onEdit={openEdit}
              tierHeader={() => null}
            />
          )}
        </TabsContent>
        <TabsContent value="firma">
          {plan.isPending ? <ListSkeleton rows={4} /> : <TieredGoals goals={plan.data?.firma ?? []} mrrRon={mrrRon} onEdit={openEdit} />}
        </TabsContent>
      </Tabs>

      <PlanGoalFormDialog open={dialogOpen} onOpenChange={setDialogOpen} scope={scope} />
      <SidePeek open={Boolean(peekedGoal)} onClose={closePeek} title={t('plan:step.editTitle')}>
        {peekedGoal ? <PlanGoalForm key={peekedGoal.id} goal={peekedGoal} scope={peekedGoal.scope} onDone={closePeek} onAddedBelow={(created) => openPeek(created.id)} /> : null}
      </SidePeek>
    </div>
  )
}
