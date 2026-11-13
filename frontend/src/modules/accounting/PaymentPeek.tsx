import { useState } from 'react'
import { toast } from 'sonner'
import { companyToday } from '@/shared/components/PeriodSelect'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { SidePeek } from '@/shared/components/ui/side-peek'
import { Textarea } from '@/shared/components/ui/textarea'
import { ApiError } from '@/shared/lib/api'
import { formatMoney } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { PaymentMethod, PaymentStatus } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { useAddPayment } from './records-api'
import { paymentConsequence } from './records-logic'
import { methodLabel, paymentWord } from './records-ui'

export interface PayableRecord {
  id: string
  direction: 'in' | 'out'
  currency: string
  amount: string | number
  documentNumber: string | null
  counterpartyName: string | null
  paymentStatus: PaymentStatus
  remaining: number
}

const METHODS: PaymentMethod[] = ['bank', 'cash', 'card', 'other']
const SERVER_ERRORS = ['DRAFT_NOT_PAYABLE', 'OVERPAYMENT', 'NOT_PAYABLE', 'CURRENCY_MISMATCH', 'PAYMENT_NOT_FOUND'] as const

function serverMessage(err: unknown): string {
  if (err instanceof ApiError && err.code && (SERVER_ERRORS as readonly string[]).includes(err.code)) {
    return t(`accounting:records.errors.${err.code as (typeof SERVER_ERRORS)[number]}` as const)
  }
  return err instanceof Error ? err.message : t('accounting:records.errors.generic')
}

const asInput = (value: number) => value.toFixed(2).replace('.', ',')

/** The collection panel: the amount defaults to the rest, and the consequence is written before the button is pressed. */
export function PaymentPeek({ record, onClose }: { record: PayableRecord | null; onClose: () => void }) {
  const title = record
    ? t(record.direction === 'out' ? 'accounting:records.pay.titleOut' : 'accounting:records.pay.titleIn', { name: record.documentNumber ?? record.counterpartyName ?? '' })
    : ''
  return (
    <SidePeek open={Boolean(record)} onClose={onClose} title={title}>
      {record ? <PaymentForm key={record.id} record={record} onClose={onClose} /> : null}
    </SidePeek>
  )
}

function PaymentForm({ record, onClose }: { record: PayableRecord; onClose: () => void }) {
  const add = useAddPayment(record.direction, record.id)
  const [amount, setAmount] = useState(asInput(record.remaining))
  const [paidAt, setPaidAt] = useState(companyToday())
  const [method, setMethod] = useState<PaymentMethod>('bank')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; paidAt?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const typed = parseRoDecimal(amount)
  const consequence = paymentConsequence({ amount: Number(record.amount), remaining: record.remaining, typed })
  const overpays = Number.isFinite(typed) && typed - record.remaining > 0.005

  const submit = () => {
    const next: typeof errors = {}
    if (!Number.isFinite(typed) || typed <= 0) next.amount = t('accounting:records.pay.amountInvalid')
    else if (overpays) next.amount = t('accounting:records.pay.amountOver', { rest: formatMoney(record.remaining, record.currency) })
    if (!paidAt) next.paidAt = t('accounting:records.pay.dateRequired')
    setErrors(next)
    setServerError(null)
    if (next.amount || next.paidAt) return
    add.mutate(
      { amount: typed, paidAt, method, reference: reference.trim() || undefined, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(t('accounting:records.pay.saved', { amount: formatMoney(typed, record.currency), name: record.documentNumber ?? record.counterpartyName ?? '' }))
          onClose()
        },
        onError: (err) => setServerError(serverMessage(err)),
      },
    )
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t('accounting:records.pay.rest', { rest: formatMoney(record.remaining, record.currency), total: formatMoney(record.amount, record.currency) })}
      </p>
      <Field label={t('accounting:records.pay.amount')} error={errors.amount}>
        <Input inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} className="tnum" />
      </Field>
      <Field label={t('accounting:records.pay.date')} error={errors.paidAt}>
        <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </Field>
      <Field label={t('accounting:records.pay.method')}>
        <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)} options={METHODS.map((value) => ({ value, label: methodLabel(value) }))} />
      </Field>
      <Field label={t('accounting:records.pay.reference')} optional>
        <Input value={reference} maxLength={140} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Field label={t('accounting:records.pay.note')} optional>
        <Textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <p aria-live="polite" className="min-h-5 text-sm" data-testid="payment-consequence">
        {consequence && !overpays
          ? t('accounting:records.pay.consequence', {
              from: paymentWord(record.direction, record.paymentStatus),
              to: paymentWord(record.direction, consequence.next),
              rest: formatMoney(consequence.rest, record.currency),
            })
          : null}
      </p>
      {serverError ? <Alert tone="critical">{serverError}</Alert> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" disabled={add.isPending} data-testid="payment-submit">
          {Number.isFinite(typed) && typed > 0 ? t('accounting:records.pay.submitAmount', { amount: formatMoney(typed, record.currency) }) : t('accounting:records.pay.submit')}
        </Button>
      </div>
    </form>
  )
}
