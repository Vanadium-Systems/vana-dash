import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { api, ApiError } from '@/shared/lib/api'
import { formatMoney, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { FinancialRecord, RecordDetail } from '@/shared/lib/types'
import { useInvalidateRecords } from './records-api'
import { checkStornoQuantity, fullStornoCents, partialStornoCents } from './storno-logic'

type Mode = 'full' | 'partial'

const SERVER_ERRORS = ['NOT_STORNABLE', 'STORNO_EXCEEDS', 'NOTHING_TO_STORNO'] as const

function serverMessage(err: unknown): string {
  if (err instanceof ApiError && err.code && (SERVER_ERRORS as readonly string[]).includes(err.code)) {
    return t(`accounting:storno.errors.${err.code as (typeof SERVER_ERRORS)[number]}` as const)
  }
  return t('accounting:storno.errors.generic')
}

/** Credit-note dialog: whole invoice or chosen quantities. It only creates the draft; issuing happens in the editor. */
export function StornoDialog({ data, open, onOpenChange }: { data: RecordDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { record, lines } = data
  const navigate = useNavigate()
  const invalidate = useInvalidateRecords()
  const [mode, setMode] = useState<Mode>('full')
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const number = record.documentNumber ?? ''

  const checks = useMemo(() => Object.fromEntries(lines.map((line) => [line.id, checkStornoQuantity(inputs[line.id] ?? '', line.quantity)])), [lines, inputs])
  const picked = useMemo(() => {
    const out: Record<string, number> = {}
    for (const line of lines) {
      const check = checks[line.id]
      if (check?.state === 'ok') out[line.id] = check.value
    }
    return out
  }, [lines, checks])
  const hasBad = lines.some((line) => checks[line.id]?.state === 'invalid' || checks[line.id]?.state === 'exceeds')
  const pickedCount = Object.keys(picked).length

  const cents = mode === 'full' ? fullStornoCents(Number(record.amount), data.storno.correctedBy) : partialStornoCents(lines, picked)

  const create = useMutation({
    mutationFn: () =>
      api.post<FinancialRecord>(
        `/api/invoicing/invoices/${record.id}/storno`,
        mode === 'full' ? { mode: 'full' } : { mode: 'partial', lines: Object.entries(picked).map(([lineId, quantity]) => ({ lineId, quantity })) },
      ),
    onSuccess: (draft) => {
      invalidate()
      toast.success(t('accounting:storno.created'))
      onOpenChange(false)
      navigate(`/accounting/records/${draft.id}/edit`)
    },
    onError: (err) => setServerError(serverMessage(err)),
  })

  const submit = () => {
    setServerError(null)
    if (mode === 'partial' && (hasBad || pickedCount === 0)) {
      setShowErrors(true)
      return
    }
    create.mutate()
  }

  const lineError = (lineId: string, invoiced: number): string | undefined => {
    const check = checks[lineId]
    if (!showErrors || !check) return undefined
    if (check.state === 'invalid') return t('accounting:storno.quantityInvalid')
    if (check.state === 'exceeds') return t('accounting:storno.quantityExceeds', { max: formatNumber(invoiced) })
    return undefined
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto md:max-w-xl">
        <DialogHeader className="pr-6">
          <DialogTitle>{t('accounting:storno.title', { number })}</DialogTitle>
          <DialogDescription>{t('accounting:storno.intro')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div role="radiogroup" aria-label={t('accounting:storno.modeLabel')} className="space-y-2">
            {(['full', 'partial'] as const).map((value) => (
              <label key={value} className="flex min-h-control-lg cursor-pointer items-start gap-3 rounded-md px-1 py-1.5 hover:bg-accent/50">
                <input type="radio" name="storno-mode" checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-primary" />
                <span className="min-w-0 text-sm">
                  <span className="block font-medium">{value === 'full' ? t('accounting:storno.modeFull') : t('accounting:storno.modePartial')}</span>
                  <span className="block text-muted-foreground">{value === 'full' ? t('accounting:storno.modeFullHint') : t('accounting:storno.modePartialHint')}</span>
                </span>
              </label>
            ))}
          </div>

          {mode === 'partial' ? (
            <ul className="space-y-3" data-testid="storno-lines">
              {lines.map((line) => (
                <li key={line.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-start">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{line.description}</div>
                    <div className="text-muted-foreground">{t('accounting:storno.invoiced', { quantity: formatNumber(line.quantity) })}</div>
                  </div>
                  <Field label={t('accounting:storno.toReverse')} error={lineError(line.id, line.quantity)}>
                    <Input
                      inputMode="decimal"
                      autoComplete="off"
                      className="tnum"
                      value={inputs[line.id] ?? ''}
                      onChange={(e) => setInputs((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </Field>
                </li>
              ))}
              {showErrors && !hasBad && pickedCount === 0 ? <li className="text-xs text-destructive-text">{t('accounting:storno.pickOne')}</li> : null}
            </ul>
          ) : null}

          <p aria-live="polite" className="min-h-5 text-sm" data-testid="storno-consequence">
            {cents > 0
              ? t('accounting:storno.consequence', { amount: formatMoney(-cents / 100, record.currency), number })
              : mode === 'partial'
                ? t('accounting:storno.consequencePick')
                : null}
          </p>
          {serverError ? <Alert tone="critical">{serverError}</Alert> : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending} data-testid="storno-submit">
              {t('accounting:storno.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
