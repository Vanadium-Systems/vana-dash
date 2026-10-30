import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { DeclarationLine, ReverseChargeType } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'

// Recurring expenses land with the subscription's amount and due date and no invoice number, so
// the real invoice is copied here before the declaration is downloaded.
export function DeclarationLineDialog({ line, onOpenChange }: { line: DeclarationLine | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [documentNumber, setDocumentNumber] = useState('')
  const [issuedAt, setIssuedAt] = useState('')
  const [amount, setAmount] = useState('')
  const [reverseChargeType, setReverseChargeType] = useState<ReverseChargeType>('eu_services')
  const [amountError, setAmountError] = useState<string | null>(null)

  useEffect(() => {
    if (!line) return
    setDocumentNumber(line.documentNumber)
    setIssuedAt(line.issuedAt.slice(0, 10))
    setAmount(String(line.amountForeign))
    setReverseChargeType(line.reverseChargeType)
    setAmountError(null)
  }, [line])

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/accounting/d301/lines/${line!.recordId}`, {
        documentNumber,
        issuedAt,
        amount: parseRoDecimal(amount),
        reverseChargeType,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(t('common:states.updated'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={line !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('accounting:declarations.edit.title', { supplier: line?.counterpartyName || '—' })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!(parseRoDecimal(amount) > 0)) {
              setAmountError(t('accounting:declarations.edit.amountInvalid'))
              return
            }
            save.mutate()
          }}
        >
          <Field label={t('accounting:declarations.edit.documentNumber')} hint={t('accounting:declarations.edit.documentNumberHint')}>
            <Input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} maxLength={50} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('accounting:declarations.edit.issuedAt')}>
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} required />
            </Field>
            <Field label={t('accounting:declarations.edit.amount', { currency: line?.currency ?? '' })} error={amountError}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <Field label={t('accounting:declarations.edit.type')}>
            <Select value={reverseChargeType} onChange={(e) => setReverseChargeType(e.target.value as ReverseChargeType)}>
              <option value="eu_services">{t('accounting:declarations.edit.typeEu')}</option>
              <option value="non_eu_services">{t('accounting:declarations.edit.typeNonEu')}</option>
              <option value="none">{t('accounting:declarations.edit.typeNone')}</option>
            </Select>
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common:actions.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
