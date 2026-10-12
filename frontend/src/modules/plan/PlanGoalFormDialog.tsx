import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import type { PlanGoal, PlanScope, PlanTargetPriceCurrency, PlanThresholdType } from '@/shared/lib/types'
import { tierLabel } from './tiers'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'


interface PlanGoalFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  goal: PlanGoal | null
  /** Pista curentă din PlanPage — preselectată la creare, fixă la editare. */
  scope: PlanScope
}

export function PlanGoalFormDialog({ open, onOpenChange, goal, scope }: PlanGoalFormDialogProps) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [tier, setTier] = useState(1)
  const [thresholdType, setThresholdType] = useState<PlanThresholdType>('manual')
  const [thresholdValue, setThresholdValue] = useState('')
  const [monthlyCostRon, setMonthlyCostRon] = useState('')
  const [targetPriceAmount, setTargetPriceAmount] = useState('')
  const [targetPriceCurrency, setTargetPriceCurrency] = useState<PlanTargetPriceCurrency>('EUR')
  const [targetDate, setTargetDate] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(goal?.title ?? '')
    setNote(goal?.note ?? '')
    setTier(goal?.tier ?? 1)
    setThresholdType(goal?.thresholdType ?? 'manual')
    setThresholdValue(goal?.thresholdValue ?? '')
    setMonthlyCostRon(goal?.monthlyCostRon ?? '')
    setTargetPriceAmount(goal?.targetPriceAmount ?? '')
    setTargetPriceCurrency(goal?.targetPriceCurrency ?? 'EUR')
    setTargetDate(goal?.targetDate ?? '')
  }, [open, goal])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        note: note || undefined,
        tier: scope === 'firma' ? tier : undefined,
        thresholdType,
        thresholdValue: thresholdType === 'mrr_ron' && thresholdValue ? parseRoDecimal(thresholdValue) : undefined,
        monthlyCostRon: monthlyCostRon ? parseRoDecimal(monthlyCostRon) : goal ? null : undefined,
        targetPriceAmount: targetPriceAmount ? parseRoDecimal(targetPriceAmount) : goal ? null : undefined,
        targetPriceCurrency: targetPriceAmount ? targetPriceCurrency : goal ? null : undefined,
        targetDate: targetDate ? targetDate : goal ? null : undefined,
      }
      return goal
        ? api.patch<PlanGoal>(`/api/plan/${goal.id}`, body)
        : api.post<PlanGoal>('/api/plan', { ...body, scope })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plan'] })
      toast.success(goal ? t('plan:step.updated') : t('plan:step.added'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/plan/${goal?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plan'] })
      toast.success(t('plan:step.deleted'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{goal ? t('plan:step.editTitle') : t('plan:step.new')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="pg-title">{t('common:labels.title')}</Label>
            <Input id="pg-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pg-note">{t('plan:step.note')}</Label>
            <Textarea id="pg-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pg-target-date">{t('plan:step.deadline')}</Label>
            <Input id="pg-target-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pg-target-price">{t('plan:step.targetPrice')}</Label>
              <Input
                id="pg-target-price"
                inputMode="decimal"
                placeholder={t('plan:step.targetPricePlaceholder')}
                value={targetPriceAmount}
                onChange={(e) => setTargetPriceAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pg-target-price-currency">{t('common:labels.currency')}</Label>
              <Select
                id="pg-target-price-currency"
                value={targetPriceCurrency}
                onChange={(e) => setTargetPriceCurrency(e.target.value as PlanTargetPriceCurrency)}
                disabled={!targetPriceAmount}
              >
                <option value="EUR">EUR</option>
                <option value="RON">RON</option>
              </Select>
            </div>
          </div>
          {scope === 'firma' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pg-tier">{t('plan:step.tier')}</Label>
                <Select id="pg-tier" value={tier} onChange={(e) => setTier(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((tier) => (
                    <option key={tier} value={tier}>
                      {tierLabel(tier)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pg-monthly-cost">{t('plan:step.monthlyCost')}</Label>
                <Input
                  id="pg-monthly-cost"
                  inputMode="decimal"
                  placeholder={t('plan:step.monthlyCostPlaceholder')}
                  value={monthlyCostRon}
                  onChange={(e) => setMonthlyCostRon(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pg-threshold-type">{t('plan:step.thresholdType')}</Label>
              <Select
                id="pg-threshold-type"
                value={thresholdType}
                onChange={(e) => setThresholdType(e.target.value as PlanThresholdType)}
              >
                <option value="manual">{t('plan:step.manual')}</option>
                <option value="mrr_ron">{t('plan:step.currentMrr')}</option>
              </Select>
            </div>
            {thresholdType === 'mrr_ron' ? (
              <div className="space-y-2">
                <Label htmlFor="pg-threshold-value">{t('plan:step.mrrThreshold')}</Label>
                <Input
                  id="pg-threshold-value"
                  inputMode="decimal"
                  value={thresholdValue}
                  onChange={(e) => setThresholdValue(e.target.value)}
                  required
                />
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('plan:step.thresholdHint')}
          </p>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending ? t('common:states.saving') : t('common:actions.save')}
            </Button>
            {goal ? (
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  void confirm({ title: t('plan:step.deleteTitle', { title: goal.title }), confirmLabel: t('plan:step.deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate())
                }}
              >
                {t('common:actions.delete')}
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
