import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { formatMoney, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { LineDraft, LineState } from './invoice-editor-logic'

export interface RateInfo {
  pending: boolean
  failed: boolean
  rate?: string
  date?: string
}

interface InvoiceLinesProps {
  lines: LineDraft[]
  states: LineState[]
  currency: string
  locked: boolean
  rates: Record<'EUR' | 'USD', RateInfo>
  onChange: (index: number, key: keyof LineDraft, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}

// Each line is a block with its labels above the fields, at every width: the form column is
// only ~500px next to the preview, so a single row of five fields would not fit there either.
export function InvoiceLines({ lines, states, currency, locked, rates, onChange, onAdd, onRemove }: InvoiceLinesProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">{t('accounting:editor.lines.title')}</h2>
      <div className="divide-y">
        {lines.map((line, i) => (
          <fieldset key={i} className="space-y-3 py-4 first:pt-0" disabled={locked}>
            <legend className="sr-only">{t('accounting:editor.lines.lineNo', { n: i + 1 })}</legend>
            <Field label={t('common:labels.description')}>
              <Input value={line.description} onChange={(e) => onChange(i, 'description', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_6rem_5rem]">
              <Field label={t('common:labels.quantity')}>
                <Input inputMode="decimal" value={line.quantity} onChange={(e) => onChange(i, 'quantity', e.target.value)} />
              </Field>
              <Field label={t('common:labels.price')}>
                <Input inputMode="decimal" value={line.price} onChange={(e) => onChange(i, 'price', e.target.value)} />
              </Field>
              <Field label={t('accounting:editor.lines.priceCurrency')}>
                <Select value={line.priceCurrency} onChange={(e) => onChange(i, 'priceCurrency', e.target.value)}>
                  <option value="">{currency}</option>
                  {(['EUR', 'USD'] as const)
                    .filter((c) => c !== currency)
                    .map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t('common:labels.vatPercent')}>
                <Input inputMode="decimal" value={line.vatRate} onChange={(e) => onChange(i, 'vatRate', e.target.value)} />
              </Field>
            </div>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-sm text-muted-foreground tnum" aria-live="polite">
                <LineTotal line={line} state={states[i]} currency={currency} rates={rates} />
              </p>
              {!locked ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={lines.length === 1}
                  aria-label={t('accounting:editor.lines.remove', { n: i + 1 })}
                  onClick={() => onRemove(i)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </fieldset>
        ))}
      </div>
      {!locked ? (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" /> {t('accounting:editor.lines.add')}
        </Button>
      ) : null}
    </div>
  )
}

function LineTotal({ line, state, currency, rates }: { line: LineDraft; state: LineState | undefined; currency: string; rates: Record<'EUR' | 'USD', RateInfo> }) {
  if (state?.kind === 'pending') {
    const failed = line.priceCurrency && line.priceCurrency !== currency && rates[line.priceCurrency].failed
    return <>{t(failed ? 'accounting:editor.lines.rateFailed' : 'accounting:editor.lines.fetchingRate')}</>
  }
  if (state?.kind !== 'ok') return null
  const { line: parsed, amounts } = state
  const base = t(parsed.vatRate > 0 ? 'accounting:editor.lines.live' : 'accounting:editor.lines.liveNoVat', {
    qty: formatNumber(parsed.quantity),
    unit: formatMoney(parsed.unitPrice, currency),
    net: formatMoney(amounts.netCents / 100, currency),
    rate: formatNumber(parsed.vatRate),
    vat: formatMoney(amounts.vatCents / 100, currency),
  })
  const foreign = line.priceCurrency && line.priceCurrency !== currency ? rates[line.priceCurrency] : null
  return (
    <>
      {base}
      {foreign?.rate ? <span className="block text-xs">{t('accounting:editor.lines.converted', { rate: foreign.rate, date: foreign.date })}</span> : null}
    </>
  )
}
