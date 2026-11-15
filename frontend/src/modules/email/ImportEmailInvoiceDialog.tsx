import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { ReverseChargeType } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'

export interface ImportEmailInvoiceTarget {
  messageId: string
  attachmentId: string
  filename: string
}

interface PrefillResponse {
  messageId: string
  attachmentId: string
  filename: string
  fromAddress: string
  senderEmail: string
  subject: string
  receivedAt: string
  suggested: {
    counterpartyName: string
    counterpartyCif: string | null
    counterpartyCountry: string | null
    documentNumber: string | null
    issuedAt: string
    amount: number | null
    currency: 'RON' | 'EUR' | 'USD'
    category: string | null
    reverseChargeType: ReverseChargeType
    reverseChargeVatRate: number | null
    senderPattern: string
    attachmentNamePattern: string | null
  }
  existingRecordId: string | null
}

interface ImportEmailInvoiceDialogProps {
  target: ImportEmailInvoiceTarget | null
  onOpenChange: (open: boolean) => void
}

export function ImportEmailInvoiceDialog({ target, onOpenChange }: ImportEmailInvoiceDialogProps) {
  const { can } = useMe()
  const queryClient = useQueryClient()
  const canManageRules = can('facturi.setari')

  const prefill = useQuery({
    queryKey: ['accounting', 'email-import-prefill', target?.messageId, target?.attachmentId],
    queryFn: () =>
      api.get<PrefillResponse>(
        `/api/accounting/email-import/prefill?messageId=${encodeURIComponent(target!.messageId)}&attachmentId=${encodeURIComponent(target!.attachmentId)}`,
      ),
    enabled: Boolean(target),
  })

  const [counterpartyName, setCounterpartyName] = useState('')
  const [counterpartyCif, setCounterpartyCif] = useState('')
  const [counterpartyCountry, setCounterpartyCountry] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [issuedAt, setIssuedAt] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<'RON' | 'EUR' | 'USD'>('EUR')
  const [reverseChargeType, setReverseChargeType] = useState<ReverseChargeType>('none')
  const [reverseChargeVatRate, setReverseChargeVatRate] = useState('21')
  const [createRule, setCreateRule] = useState(false)
  const [senderPattern, setSenderPattern] = useState('')
  const [attachmentNamePattern, setAttachmentNamePattern] = useState('')

  useEffect(() => {
    const s = prefill.data?.suggested
    if (!s) return
    setCounterpartyName(s.counterpartyName ?? '')
    setCounterpartyCif(s.counterpartyCif ?? '')
    setCounterpartyCountry(s.counterpartyCountry ?? '')
    setDocumentNumber(s.documentNumber ?? '')
    setIssuedAt(s.issuedAt ? s.issuedAt.slice(0, 10) : new Date().toISOString().slice(0, 10))
    setAmount(s.amount != null ? String(s.amount) : '')
    setCurrency(s.currency ?? 'EUR')
    setReverseChargeType(s.reverseChargeType ?? 'none')
    setReverseChargeVatRate(s.reverseChargeVatRate != null ? String(s.reverseChargeVatRate) : '21')
    setCreateRule(false)
    setSenderPattern(s.senderPattern ?? '')
    setAttachmentNamePattern(s.attachmentNamePattern ?? '')
  }, [prefill.data])

  const submit = useMutation({
    mutationFn: async () => {
      if (!target) return
      const parsedAmount = parseRoDecimal(amount)
      if (parsedAmount == null || !Number.isFinite(parsedAmount) || parsedAmount < 0) {
        throw new Error(t('accounting:records.pay.amountInvalid'))
      }
      const parsedVat = reverseChargeVatRate.trim()
        ? parseRoDecimal(reverseChargeVatRate)
        : null
      return api.post('/api/accounting/email-import', {
        messageId: target.messageId,
        attachmentId: target.attachmentId,
        counterpartyName: counterpartyName.trim(),
        counterpartyCif: counterpartyCif.trim() || null,
        counterpartyCountry: counterpartyCountry.trim().toUpperCase() || null,
        documentNumber: documentNumber.trim() || null,
        issuedAt,
        amount: parsedAmount,
        currency,
        category: prefill.data?.suggested.category ?? null,
        reverseChargeType,
        reverseChargeVatRate:
          reverseChargeType === 'none'
            ? null
            : parsedVat != null && Number.isFinite(parsedVat)
              ? parsedVat
              : null,
        createRule: canManageRules && createRule,
        senderPattern: canManageRules && createRule ? senderPattern.trim() || null : null,
        attachmentNamePattern:
          canManageRules && createRule ? attachmentNamePattern.trim() || null : null,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(t('email:importInvoiceDialog.successToast'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('email:importInvoiceDialog.title')}</DialogTitle>
          <DialogDescription>{t('email:importInvoiceDialog.subtitle')}</DialogDescription>
        </DialogHeader>

        {prefill.isPending ? (
          <ListSkeleton rows={4} />
        ) : prefill.isError ? (
          <Alert tone="critical" title={prefill.error.message} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit.mutate()
            }}
            className="space-y-4"
          >
            {target ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {t('email:importInvoiceDialog.attachmentLabel')}:{' '}
                </span>
                <span className="font-medium">{target.filename}</span>
              </div>
            ) : null}

            <Field label={t('email:importInvoiceDialog.counterpartyName')}>
              <Input
                id="ei-name"
                value={counterpartyName}
                onChange={(e) => setCounterpartyName(e.target.value)}
                required
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('email:importInvoiceDialog.counterpartyCif')}>
                <Input
                  id="ei-cif"
                  value={counterpartyCif}
                  onChange={(e) => setCounterpartyCif(e.target.value)}
                />
              </Field>
              <Field label={t('email:importInvoiceDialog.counterpartyCountry')}>
                <Input
                  id="ei-country"
                  maxLength={2}
                  value={counterpartyCountry}
                  onChange={(e) => setCounterpartyCountry(e.target.value.toUpperCase())}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('email:importInvoiceDialog.documentNumber')}>
                <Input
                  id="ei-doc"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                />
              </Field>
              <Field label={t('email:importInvoiceDialog.issuedAt')}>
                <Input
                  id="ei-date"
                  type="date"
                  value={issuedAt}
                  onChange={(e) => setIssuedAt(e.target.value)}
                  required
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('email:importInvoiceDialog.amount')}>
                <Input
                  id="ei-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </Field>
              <Field label={t('email:importInvoiceDialog.currency')}>
                <Select
                  id="ei-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as 'RON' | 'EUR' | 'USD')}
                >
                  <option value="EUR">EUR</option>
                  <option value="RON">RON</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('email:importInvoiceDialog.reverseChargeType')}>
                <Select
                  id="ei-rc"
                  value={reverseChargeType}
                  onChange={(e) => setReverseChargeType(e.target.value as ReverseChargeType)}
                >
                  <option value="none">{t('accounting:reverseCharge.none')}</option>
                  <option value="eu_services">{t('accounting:reverseCharge.eu')}</option>
                  <option value="non_eu_services">{t('accounting:reverseCharge.nonEu')}</option>
                </Select>
              </Field>
              {reverseChargeType !== 'none' ? (
                <Field label={t('email:importInvoiceDialog.reverseChargeVatRate')}>
                  <Input
                    id="ei-vat"
                    inputMode="decimal"
                    value={reverseChargeVatRate}
                    onChange={(e) => setReverseChargeVatRate(e.target.value)}
                  />
                </Field>
              ) : null}
            </div>

            {canManageRules ? (
              <div className="space-y-3 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={createRule}
                    onChange={(e) => setCreateRule(e.target.checked)}
                  />
                  <span>{t('email:importInvoiceDialog.createRuleLabel')}</span>
                </label>
                {createRule ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('email:importInvoiceDialog.senderPatternLabel')}>
                      <Input
                        id="ei-sender"
                        value={senderPattern}
                        onChange={(e) => setSenderPattern(e.target.value)}
                      />
                    </Field>
                    <Field label={t('email:importInvoiceDialog.attachmentPatternLabel')}>
                      <Input
                        id="ei-att-pat"
                        value={attachmentNamePattern}
                        onChange={(e) => setAttachmentNamePattern(e.target.value)}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending
                  ? t('email:importInvoiceDialog.submitting')
                  : t('email:importInvoiceDialog.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
