import { useQuery } from '@tanstack/react-query'
import { Select } from '@/shared/components/ui/select'
import { api } from '@/shared/lib/api'
import { formatMoney, formatNumber } from '@/shared/lib/format'
import type { FilterClause } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import { CALC_FNS } from './columns'
import type { AggregateResult, CalcField, CalcFn } from './types'
import { filterParams } from './use-prospect-data'

function resultText(field: CalcField, fn: CalcFn, data: AggregateResult, currency: string): string {
  // Value sums are per currency: adding RON to EUR would be a wrong number.
  if (data.byCurrency) return data.byCurrency.map((entry) => (entry.amount === null ? '—' : formatMoney(entry.amount, entry.currency ?? currency, { decimals: 0 }))).join(' · ') || '—'
  if (data.value === null) return '—'
  return field === 'revenue' && fn !== 'count' ? formatNumber(data.value, BASE_CURRENCY) : formatNumber(data.value)
}

/** "+ Calcul" under a numeric column: the result covers every filtered row, not the page. */
export function CalcCell({ field, fn, f, q, currency, label, onChange }: { field: CalcField; fn: CalcFn | undefined; f: FilterClause[]; q: string; currency: string; label: string; onChange: (fn: CalcFn | null) => void }) {
  const result = useQuery({
    queryKey: ['prospects', 'aggregate', field, fn, filterParams(f, q)],
    queryFn: () => api.get<AggregateResult>(`/api/prospects/aggregate?${filterParams(f, q, { field, fn: fn! })}`),
    enabled: Boolean(fn),
  })
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Select size="sm" className="w-28" aria-label={label} value={fn ?? ''} onValueChange={(value) => onChange((value || null) as CalcFn | null)}>
        <option value="">{t('clients:prospects.calc.add')}</option>
        {CALC_FNS.map((option) => (
          <option key={option} value={option}>
            {t(`clients:prospects.calc.${option}`)}
          </option>
        ))}
      </Select>
      {fn ? <span className="text-xs tabular-nums text-muted-foreground">{result.data ? resultText(field, fn, result.data, currency) : null}</span> : null}
    </div>
  )
}
