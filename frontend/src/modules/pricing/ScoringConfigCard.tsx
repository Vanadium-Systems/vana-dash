import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { ProspectScoringConfig } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

// Doar cele 4 ponderi + 3 praguri sunt editabile — curbele din sub-scoruri rămân constante fixe
// în backend (decizie de scop, vezi PLAN.md: control fin nefolosit practic în teren).
export function ScoringConfigCard() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    budgetWeight: '',
    needWeight: '',
    techWeight: '',
    contactWeight: '',
    hotThreshold: '',
    warmThreshold: '',
    nurtureThreshold: '',
  })
  const [open, setOpen] = useState(false)

  const config = useQuery({
    queryKey: ['prospects', 'scoring-config'],
    queryFn: () => api.get<ProspectScoringConfig>('/api/prospects/scoring-config'),
  })

  useEffect(() => {
    if (config.data) {
      setForm({
        budgetWeight: config.data.budgetWeight,
        needWeight: config.data.needWeight,
        techWeight: config.data.techWeight,
        contactWeight: config.data.contactWeight,
        hotThreshold: config.data.hotThreshold,
        warmThreshold: config.data.warmThreshold,
        nurtureThreshold: config.data.nurtureThreshold,
      })
    }
  }, [config.data])

  const save = useMutation({
    mutationFn: () =>
      api.put<{ recalculated: number }>('/api/prospects/scoring-config', {
        budgetWeight: parseRoDecimal(form.budgetWeight),
        needWeight: parseRoDecimal(form.needWeight),
        techWeight: parseRoDecimal(form.techWeight),
        contactWeight: parseRoDecimal(form.contactWeight),
        hotThreshold: parseRoDecimal(form.hotThreshold),
        warmThreshold: parseRoDecimal(form.warmThreshold),
        nurtureThreshold: parseRoDecimal(form.nurtureThreshold),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      toast.success(t('pricing:scoring.saved', { count: data.recalculated }))
    },
    onError: (err) => toast.error(err.message),
  })

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t('pricing:scoring.title')}</CardTitle>
        <Button type="button" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? t('common:actions.hide') : t('common:actions.show')}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="sc-budget" className="text-xs">
                {t('pricing:scoring.budgetWeight')}
              </Label>
              <Input id="sc-budget" inputMode="decimal" value={form.budgetWeight} onChange={set('budgetWeight')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-need" className="text-xs">
                {t('pricing:scoring.needWeight')}
              </Label>
              <Input id="sc-need" inputMode="decimal" value={form.needWeight} onChange={set('needWeight')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-tech" className="text-xs">
                {t('pricing:scoring.techWeight')}
              </Label>
              <Input id="sc-tech" inputMode="decimal" value={form.techWeight} onChange={set('techWeight')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-contact" className="text-xs">
                {t('pricing:scoring.contactWeight')}
              </Label>
              <Input id="sc-contact" inputMode="decimal" value={form.contactWeight} onChange={set('contactWeight')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="sc-hot" className="text-xs">
                {t('pricing:scoring.hotThreshold')}
              </Label>
              <Input id="sc-hot" inputMode="decimal" value={form.hotThreshold} onChange={set('hotThreshold')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-warm" className="text-xs">
                {t('pricing:scoring.warmThreshold')}
              </Label>
              <Input id="sc-warm" inputMode="decimal" value={form.warmThreshold} onChange={set('warmThreshold')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-nurture" className="text-xs">
                {t('pricing:scoring.nurtureThreshold')}
              </Label>
              <Input id="sc-nurture" inputMode="decimal" value={form.nurtureThreshold} onChange={set('nurtureThreshold')} />
            </div>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common:states.saving') : t('pricing:scoring.save')}
          </Button>
        </CardContent>
      )}
    </Card>
  )
}
