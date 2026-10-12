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
      toast.success('Cheltuială recurentă salvată')
      setEditingId(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/accounting/recurring-expenses/${id}`, { active }),
    onSuccess: () => {
      void invalidate()
      toast.success('Actualizat')
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleShowInCalendar = useMutation({
    mutationFn: ({ id, showInCalendar }: { id: string; showInCalendar: boolean }) =>
      api.patch(`/api/accounting/recurring-expenses/${id}`, { showInCalendar }),
    onSuccess: () => {
      void invalidate()
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success('Actualizat')
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/accounting/recurring-expenses/${id}`),
    onSuccess: () => {
      void invalidate()
      toast.success('Cheltuială recurentă ștearsă')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Cheltuieli recurente</Label>
        {editingId === null && (
          <Button type="button" variant="outline" onClick={() => { setForm(emptyForm()); setEditingId('new') }}>
            <Plus className="h-4 w-4" /> Cheltuială recurentă nouă
          </Button>
        )}
      </div>

      {expenses.isPending ? (
        <p className="text-xs text-muted-foreground">Se încarcă…</p>
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
                  ({formatMoney(e.amount, e.currency)} / {e.cycle === 'monthly' ? 'lună' : 'an'}, următoarea: {formatDate(e.nextDueDate)})
                </span>
                {!e.active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">pauză</span>}
                {e.reverseChargeType !== 'none' && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">TVA invers</span>
                )}
                {!e.autoMaterialize && (
                  <span
                    className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                    title="Doar reminder de calendar — factura reală se introduce manual"
                  >
                    doar reminder
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  title={e.active ? 'Pune pe pauză' : 'Reactivează'}
                  disabled={toggleActive.isPending}
                  onClick={() => toggleActive.mutate({ id: e.id, active: !e.active })}
                >
                  {e.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  title={e.showInCalendar ? 'Ascunde din Calendar' : 'Arată în Calendar'}
                  disabled={toggleShowInCalendar.isPending}
                  onClick={() => toggleShowInCalendar.mutate({ id: e.id, showInCalendar: !e.showInCalendar })}
                >
                  {e.showInCalendar ? <CalendarCheck className="h-4 w-4" /> : <CalendarX className="h-4 w-4 text-muted-foreground" />}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setForm(toForm(e)); setEditingId(e.id) }}>
                  Editează
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => {
                    void confirm({ title: `Șterge cheltuiala recurentă „${e.description}”`, consequence: 'Nu se mai generează lunar. Cheltuielile deja create rămân.', confirmLabel: 'Șterge cheltuiala', destructive: true }).then((ok) => ok && remove.mutate(e.id))
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        editingId === null && <p className="text-xs text-muted-foreground">Nicio cheltuială recurentă încă.</p>
      )}

      {editingId !== null && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-2">
            <Label htmlFor="re-description">Descriere</Label>
            <Input
              id="re-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="ex: Abonament AWS"
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="re-category">Categorie (opțional)</Label>
              <Input id="re-category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="ex: hosting" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="re-amount">Sumă</Label>
                <Input id="re-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="re-currency">Monedă</Label>
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
              <Label htmlFor="re-cycle">Cadență</Label>
              <Select
                id="re-cycle"
                value={form.cycle}
                onChange={(e) => setForm((f) => ({ ...f, cycle: e.target.value as FormState['cycle'] }))}
              >
                <option value="monthly">Lunar</option>
                <option value="annual">Anual</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="re-cycle-day">Ziua din lună</Label>
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
                <Label htmlFor="re-cycle-month">Luna</Label>
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
            <Label htmlFor="re-counterparty">Furnizor (opțional)</Label>
            <Input
              id="re-counterparty"
              value={form.counterpartyName}
              onChange={(e) => setForm((f) => ({ ...f, counterpartyName: e.target.value }))}
              placeholder="ex: Hetzner Online GmbH"
            />
          </div>

          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2">
              <Label htmlFor="re-reverse-charge">Tip achiziție (taxare inversă TVA)</Label>
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
                <option value="none">Fără taxare inversă</option>
                <option value="eu_services">UE — servicii (ex: Hetzner)</option>
                <option value="non_eu_services">Non-UE — servicii (ex: Cloudflare)</option>
              </Select>
              <p className="text-xs text-muted-foreground">Se copiază pe fiecare cheltuială materializată — apare în D301/D390.</p>
            </div>
            {form.reverseChargeType !== 'none' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="re-rc-country">Țara furnizorului (ISO-2)</Label>
                  <Input
                    id="re-rc-country"
                    value={form.counterpartyCountry}
                    onChange={(e) => setForm((f) => ({ ...f, counterpartyCountry: e.target.value.toUpperCase() }))}
                    placeholder={form.reverseChargeType === 'eu_services' ? 'ex: DE' : 'ex: US'}
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="re-rc-vatid">Cod TVA furnizor{form.reverseChargeType === 'eu_services' ? '' : ' (opțional)'}</Label>
                  <Input
                    id="re-rc-vatid"
                    value={form.counterpartyCif}
                    onChange={(e) => setForm((f) => ({ ...f, counterpartyCif: e.target.value }))}
                    placeholder="fără prefix de țară"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="re-rc-rate">Cotă TVA (%)</Label>
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
            Generează automat cheltuiala
          </label>
          <p className="text-xs text-muted-foreground">
            Debifează dacă furnizorul trimite ulterior o factură reală pe care o introduci tu manual — jobul rămâne
            doar reminder de calendar și nu mai dublează cheltuiala.
          </p>

          <div className="flex gap-2">
            <Button type="button" disabled={save.isPending || !form.description} onClick={() => save.mutate()}>
              {save.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
              Anulează
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
