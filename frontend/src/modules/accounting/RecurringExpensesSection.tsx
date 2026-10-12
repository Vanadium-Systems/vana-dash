import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CalendarX, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { RecurringExpense } from '@/shared/lib/types'
import { formatDate, formatMoney } from './badges'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

interface FormState {
  description: string
  category: string
  amount: string
  currency: 'RON' | 'EUR' | 'USD'
  cycle: 'monthly' | 'annual'
  cycleDay: string
  cycleMonth: string
  counterpartyName: string
  reverseChargeType: 'none' | 'eu_services' | 'non_eu_services'
  counterpartyCountry: string
  counterpartyCif: string
  reverseChargeVatRate: string
  autoMaterialize: boolean
}

function emptyForm(): FormState {
  return {
    description: '',
    category: '',
    amount: '',
    currency: 'RON',
    cycle: 'monthly',
    cycleDay: '1',
    cycleMonth: '1',
    counterpartyName: '',
    reverseChargeType: 'none',
    counterpartyCountry: '',
    counterpartyCif: '',
    reverseChargeVatRate: '21',
    autoMaterialize: true,
  }
}

function toForm(e: RecurringExpense): FormState {
  return {
    description: e.description,
    category: e.category ?? '',
    amount: e.amount,
    currency: e.currency,
    cycle: e.cycle,
    cycleDay: String(e.cycleDay),
    cycleMonth: e.cycleMonth === null ? '1' : String(e.cycleMonth),
    counterpartyName: e.counterpartyName ?? '',
    reverseChargeType: e.reverseChargeType,
    counterpartyCountry: e.counterpartyCountry ?? '',
    counterpartyCif: e.counterpartyCif ?? '',
    reverseChargeVatRate: e.reverseChargeVatRate ?? '21',
    autoMaterialize: e.autoMaterialize,
  }
}

// Cheltuieli recurente (abonamente, chirie etc.) — materializate automat în financial_records
// prin jobs/recurring-expenses.ts. Pattern identic PlatformTemplatesSection.tsx (listă + form
// inline de create/edit), integrat direct în PrimiteTab.
export function RecurringExpensesSection() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())

  const expenses = useQuery({
    queryKey: ['accounting', 'recurring-expenses'],
    queryFn: () => api.get<RecurringExpense[]>('/api/accounting/recurring-expenses'),
  })

  // Invalidare pe TOT ['accounting'] (nu doar 'recurring-expenses') — altfel Declarații/Emise/
  // Primite rămân cu date vechi în cache după un save aici (bug raportat: D390 nu se actualiza
  // fără refresh manual). Mirror pe PrimiteTab/EmiseTab/PastRecordFormDialog, care deja fac asta.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['accounting'] })

  const save = useMutation({
    mutationFn: () => {
      const body = {
        description: form.description,
        category: form.category || undefined,
        amount: parseRoDecimal(form.amount),
        currency: form.currency,
        cycle: form.cycle,
        cycleDay: parseRoDecimal(form.cycleDay),
        cycleMonth: form.cycle === 'annual' ? parseRoDecimal(form.cycleMonth) : undefined,
        counterpartyName: form.counterpartyName || undefined,
        reverseChargeType: form.reverseChargeType,
        ...(form.reverseChargeType !== 'none'
          ? {
              counterpartyCountry: form.counterpartyCountry || undefined,
              counterpartyCif: form.counterpartyCif || undefined,
              // 0 e o cotă validă (achiziții non-UE, Stefan 2026-08-01) — omitem DOAR câmpul gol,
              // nu și "0" explicit (schema acceptă .nonnegative(), nu mai cere strict > 0).
              reverseChargeVatRate: form.reverseChargeVatRate === '' ? undefined : parseRoDecimal(form.reverseChargeVatRate),
            }
          : {}),
        autoMaterialize: form.autoMaterialize,
      }
      return editingId && editingId !== 'new'
        ? api.patch(`/api/accounting/recurring-expenses/${editingId}`, body)
        : api.post('/api/accounting/recurring-expenses', body)
    },
    onSuccess: () => {
      void invalidate()
      toast.success(t('accounting:recurring.saved'))
      setEditingId(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/accounting/recurring-expenses/${id}`, { active }),
    onSuccess: () => {
      void invalidate()
      toast.success(t('common:states.updated'))
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleShowInCalendar = useMutation({
    mutationFn: ({ id, showInCalendar }: { id: string; showInCalendar: boolean }) =>
      api.patch(`/api/accounting/recurring-expenses/${id}`, { showInCalendar }),
    onSuccess: () => {
      void invalidate()
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success(t('common:states.updated'))
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/accounting/recurring-expenses/${id}`),
    onSuccess: () => {
      void invalidate()
      toast.success(t('accounting:recurring.deleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{t('accounting:recurring.title')}</Label>
        {editingId === null && (
          <Button type="button" variant="outline" onClick={() => { setForm(emptyForm()); setEditingId('new') }}>
            <Plus className="h-4 w-4" /> {t('accounting:recurring.new')}
          </Button>
        )}
      </div>

      {expenses.isPending ? (
        <p className="text-xs text-muted-foreground">{t('common:states.loading')}</p>
      ) : expenses.data && expenses.data.length > 0 ? (
        <div className="space-y-2">
          {expenses.data.map((e, i) => (
            <div
              key={e.id}
              className="flex animate-in items-center justify-between rounded-md border px-3 py-2 text-sm fade-in-0 duration-200 ease-out"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              <div>
                <span className={e.active ? 'font-medium' : 'font-medium text-muted-foreground line-through'}>{e.description}</span>{' '}
                {e.counterpartyName ? <span className="text-xs text-muted-foreground">— {e.counterpartyName}</span> : null}{' '}
                <span className="text-xs text-muted-foreground">
                  {t(e.cycle === 'monthly' ? 'accounting:recurring.summaryMonthly' : 'accounting:recurring.summaryYearly', { amount: formatMoney(e.amount, e.currency), date: formatDate(e.nextDueDate) })}
                </span>
                {!e.active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{t('accounting:recurring.paused')}</span>}
                {e.reverseChargeType !== 'none' && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{t('accounting:recurring.reverseVat')}</span>
                )}
                {!e.autoMaterialize && (
                  <span
                    className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                    title={t('accounting:recurring.reminderOnlyHint')}
                  >
                    {t('accounting:recurring.reminderOnly')}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  title={e.active ? t('accounting:recurring.pause') : t('accounting:recurring.resume')}
                  disabled={toggleActive.isPending}
                  onClick={() => toggleActive.mutate({ id: e.id, active: !e.active })}
                >
                  {e.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  title={e.showInCalendar ? t('accounting:recurring.hideFromCalendar') : t('accounting:recurring.showInCalendar')}
                  disabled={toggleShowInCalendar.isPending}
                  onClick={() => toggleShowInCalendar.mutate({ id: e.id, showInCalendar: !e.showInCalendar })}
                >
                  {e.showInCalendar ? <CalendarCheck className="h-4 w-4" /> : <CalendarX className="h-4 w-4 text-muted-foreground" />}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setForm(toForm(e)); setEditingId(e.id) }}>
                  {t('common:actions.edit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => {
                    void confirm({ title: t('accounting:recurring.deleteTitle', { description: e.description }), consequence: t('accounting:recurring.deleteBody'), confirmLabel: t('accounting:recurring.deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate(e.id))
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        editingId === null && <p className="text-xs text-muted-foreground">{t('accounting:recurring.empty')}</p>
      )}

      {editingId !== null && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-2">
            <Label htmlFor="re-description">{t('common:labels.description')}</Label>
            <Input
              id="re-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('accounting:placeholders.awsSubscription')}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="re-category">{t('accounting:labels.categoryOptional')}</Label>
              <Input id="re-category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder={t('accounting:placeholders.hosting')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="re-amount">{t('common:labels.amount')}</Label>
                <Input id="re-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="re-currency">{t('common:labels.currency')}</Label>
                <Select
                  id="re-currency"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as FormState['currency'] }))}
                >
                  <option value="RON">RON</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="re-cycle">{t('accounting:recurring.cadence')}</Label>
              <Select
                id="re-cycle"
                value={form.cycle}
                onChange={(e) => setForm((f) => ({ ...f, cycle: e.target.value as FormState['cycle'] }))}
              >
                <option value="monthly">{t('common:labels.monthly')}</option>
                <option value="annual">{t('common:labels.yearly')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="re-cycle-day">{t('accounting:clientForm.dayOfMonth')}</Label>
              <Input
                id="re-cycle-day"
                inputMode="numeric"
                value={form.cycleDay}
                onChange={(e) => setForm((f) => ({ ...f, cycleDay: e.target.value }))}
                required
              />
            </div>
            {form.cycle === 'annual' && (
              <div className="space-y-2">
                <Label htmlFor="re-cycle-month">{t('common:labels.month')}</Label>
                <Input
                  id="re-cycle-month"
                  inputMode="numeric"
                  value={form.cycleMonth}
                  onChange={(e) => setForm((f) => ({ ...f, cycleMonth: e.target.value }))}
                  required
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="re-counterparty">{t('accounting:labels.supplierOptional')}</Label>
            <Input
              id="re-counterparty"
              value={form.counterpartyName}
              onChange={(e) => setForm((f) => ({ ...f, counterpartyName: e.target.value }))}
              placeholder={t('accounting:placeholders.supplier')}
            />
          </div>

          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2">
              <Label htmlFor="re-reverse-charge">{t('accounting:reverseCharge.purchaseType')}</Label>
              <Select
                id="re-reverse-charge"
                value={form.reverseChargeType}
                onChange={(e) => {
                  const reverseChargeType = e.target.value as FormState['reverseChargeType']
                  // Prefill cotă pe tip — UE 21% (cota standard), non-UE 0% (cazul curent al lui
                  // Stefan) — editabil oricând, doar punctul de plecare corect per tip.
                  const reverseChargeVatRate = reverseChargeType === 'eu_services' ? '21' : reverseChargeType === 'non_eu_services' ? '0' : form.reverseChargeVatRate
                  setForm((f) => ({ ...f, reverseChargeType, reverseChargeVatRate }))
                }}
              >
                <option value="none">{t('accounting:reverseCharge.none')}</option>
                <option value="eu_services">{t('accounting:reverseCharge.eu')}</option>
                <option value="non_eu_services">{t('accounting:reverseCharge.nonEu')}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{t('accounting:recurring.reverseChargeHint')}</p>
            </div>
            {form.reverseChargeType !== 'none' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="re-rc-country">{t('accounting:reverseCharge.supplierCountry')}</Label>
                  <Input
                    id="re-rc-country"
                    value={form.counterpartyCountry}
                    onChange={(e) => setForm((f) => ({ ...f, counterpartyCountry: e.target.value.toUpperCase() }))}
                    placeholder={form.reverseChargeType === 'eu_services' ? t('accounting:placeholders.countryDe') : t('accounting:placeholders.countryUs')}
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="re-rc-vatid">{form.reverseChargeType === 'eu_services' ? t('accounting:reverseCharge.supplierVatCode') : t('accounting:reverseCharge.supplierVatCodeOptional')}</Label>
                  <Input
                    id="re-rc-vatid"
                    value={form.counterpartyCif}
                    onChange={(e) => setForm((f) => ({ ...f, counterpartyCif: e.target.value }))}
                    placeholder={t('accounting:reverseCharge.noCountryPrefix')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="re-rc-rate">{t('accounting:reverseCharge.vatRate')}</Label>
                  <Input
                    id="re-rc-rate"
                    inputMode="decimal"
                    value={form.reverseChargeVatRate}
                    onChange={(e) => setForm((f) => ({ ...f, reverseChargeVatRate: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.autoMaterialize}
              onChange={(e) => setForm((f) => ({ ...f, autoMaterialize: e.target.checked }))}
            />
            {t('accounting:recurring.autoGenerate')}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('accounting:recurring.autoGenerateHint')}
          </p>

          <div className="flex gap-2">
            <Button type="button" disabled={save.isPending || !form.description} onClick={() => save.mutate()}>
              {save.isPending ? t('common:states.saving') : t('common:actions.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
              {t('common:actions.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
