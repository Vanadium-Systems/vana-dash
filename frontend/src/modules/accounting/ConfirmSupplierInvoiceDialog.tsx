import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
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
import { t } from '@/shared/lib/i18n'
import type { MonthCloseExpectedItem, ReverseChargeType } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import {
  useConfirmRecordReview,
  useFulfillExpectedRow,
  useUploadRecordPdf,
} from './hooks'

export type ConfirmSupplierInvoiceDialogTarget =
  | {
      mode: 'confirm'
      recordId: string
      counterpartyName?: string | null
      counterpartyCif?: string | null
      counterpartyCountry?: string | null
      documentNumber?: string | null
      issuedAt: string
      amount: number | string
      currency: string
      reverseChargeType?: ReverseChargeType
      reverseChargeVatRate?: number | string | null
    }
  | {
      mode: 'fulfill'
      month: string
      expected: MonthCloseExpectedItem
    }
  | {
      mode: 'upload-pdf'
      recordId: string
      counterpartyName?: string | null
      documentNumber?: string | null
    }

interface ConfirmSupplierInvoiceDialogProps {
  target: ConfirmSupplierInvoiceDialogTarget | null
  onOpenChange: (open: boolean) => void
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function normalizeCurrency(value: string | undefined): 'RON' | 'EUR' | 'USD' {
  if (value === 'RON' || value === 'EUR' || value === 'USD') return value
  return 'EUR'
}

export function ConfirmSupplierInvoiceDialog({
  target,
  onOpenChange,
}: ConfirmSupplierInvoiceDialogProps) {
  const confirmMutation = useConfirmRecordReview()
  const fulfillMutation = useFulfillExpectedRow()
  const uploadPdfMutation = useUploadRecordPdf()

  const [counterpartyName, setCounterpartyName] = useState('')
  const [counterpartyCif, setCounterpartyCif] = useState('')
  const [counterpartyCountry, setCounterpartyCountry] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [issuedAt, setIssuedAt] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<'RON' | 'EUR' | 'USD'>('EUR')
  const [reverseChargeType, setReverseChargeType] = useState<ReverseChargeType>('none')
  const [reverseChargeVatRate, setReverseChargeVatRate] = useState('21')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [readingFile, setReadingFile] = useState(false)

  useEffect(() => {
    if (!target) return
    setPdfFile(null)
    setReadingFile(false)

    if (target.mode === 'confirm') {
      setCounterpartyName(target.counterpartyName ?? '')
      setCounterpartyCif(target.counterpartyCif ?? '')
      setCounterpartyCountry(target.counterpartyCountry ?? '')
      setDocumentNumber(target.documentNumber ?? '')
      setIssuedAt((target.issuedAt || new Date().toISOString()).slice(0, 10))
      setAmount(String(target.amount ?? ''))
      setCurrency(normalizeCurrency(target.currency))
      const rcType = target.reverseChargeType ?? 'none'
      setReverseChargeType(rcType)
      setReverseChargeVatRate(
        target.reverseChargeVatRate != null
          ? String(target.reverseChargeVatRate)
          : rcType === 'eu_services'
            ? '21'
            : rcType === 'non_eu_services'
              ? '0'
              : '21',
      )
    } else if (target.mode === 'fulfill') {
      const exp = target.expected
      setCounterpartyName(exp.counterpartyName ?? '')
      setCounterpartyCif(exp.counterpartyCif ?? '')
      setCounterpartyCountry(exp.counterpartyCountry ?? '')
      setDocumentNumber('')
      setIssuedAt((exp.expectedDate || `${target.month}-01`).slice(0, 10))
      setAmount(exp.amount != null ? String(exp.amount) : '')
      setCurrency(normalizeCurrency(exp.currency))
      const rcType = exp.reverseChargeType ?? 'none'
      setReverseChargeType(rcType)
      setReverseChargeVatRate(
        exp.reverseChargeVatRate != null
          ? String(exp.reverseChargeVatRate)
          : rcType === 'eu_services'
            ? '21'
            : rcType === 'non_eu_services'
              ? '0'
              : '21',
      )
    }
  }, [target])

  const busy =
    readingFile ||
    confirmMutation.isPending ||
    fulfillMutation.isPending ||
    uploadPdfMutation.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target || busy) return

    if (target.mode === 'confirm') {
      const parsedAmount = parseRoDecimal(amount)
      const parsedVatRate =
        reverseChargeType !== 'none' && reverseChargeVatRate.trim() !== ''
          ? parseRoDecimal(reverseChargeVatRate)
          : null

      confirmMutation.mutate(
        {
          id: target.recordId,
          counterpartyName: counterpartyName.trim() || undefined,
          counterpartyCif: counterpartyCif.trim() || null,
          counterpartyCountry: counterpartyCountry.trim().toUpperCase() || null,
          documentNumber: documentNumber.trim() || null,
          issuedAt,
          amount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
          currency,
          reverseChargeType,
          reverseChargeVatRate:
            parsedVatRate !== null && Number.isFinite(parsedVatRate) ? parsedVatRate : null,
        },
        {
          onSuccess: () => {
            toast.success(t('accounting:monthClose.confirmDialog.confirmedToast'))
            onOpenChange(false)
          },
          onError: (err) => toast.error(err.message),
        },
      )
      return
    }

    if (!pdfFile) return

    try {
      setReadingFile(true)
      const contentBase64 = await readFileAsBase64(pdfFile)
      setReadingFile(false)

      if (target.mode === 'upload-pdf') {
        uploadPdfMutation.mutate(
          {
            id: target.recordId,
            filename: pdfFile.name,
            contentBase64,
          },
          {
            onSuccess: () => {
              toast.success(t('accounting:monthClose.confirmDialog.uploadedToast'))
              onOpenChange(false)
            },
            onError: (err) => toast.error(err.message),
          },
        )
        return
      }

      const parsedAmount = parseRoDecimal(amount)
      const parsedVatRate =
        reverseChargeType !== 'none' && reverseChargeVatRate.trim() !== ''
          ? parseRoDecimal(reverseChargeVatRate)
          : null

      fulfillMutation.mutate(
        {
          month: target.month,
          recurringExpenseId: target.expected.recurringExpenseId,
          supplierRuleId: target.expected.supplierRuleId,
          counterpartyName: counterpartyName.trim() || target.expected.counterpartyName,
          counterpartyCif: counterpartyCif.trim() || null,
          counterpartyCountry: counterpartyCountry.trim().toUpperCase() || null,
          reverseChargeType,
          reverseChargeVatRate:
            parsedVatRate !== null && Number.isFinite(parsedVatRate) ? parsedVatRate : null,
          documentNumber: documentNumber.trim() || null,
          issuedAt,
          amount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
          currency,
          filename: pdfFile.name,
          contentBase64,
        },
        {
          onSuccess: () => {
            toast.success(t('accounting:monthClose.confirmDialog.uploadedToast'))
            onOpenChange(false)
          },
          onError: (err) => toast.error(err.message),
        },
      )
    } catch (err) {
      setReadingFile(false)
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const title =
    target?.mode === 'confirm'
      ? t('accounting:monthClose.confirmDialog.titleConfirm')
      : target?.mode === 'fulfill'
        ? t('accounting:monthClose.confirmDialog.titleFulfill')
        : t('accounting:monthClose.confirmDialog.titleUploadPdf')

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        {...(target?.mode === 'confirm' ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {target?.mode === 'confirm' ? (
            <DialogDescription>
              {t('accounting:monthClose.confirmDialog.descriptionConfirm')}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          {target?.mode === 'confirm' || target?.mode === 'fulfill' ? (
            <>
              <Field label={t('accounting:monthClose.confirmDialog.counterpartyName')}>
                <Input
                  value={counterpartyName}
                  onChange={(e) => setCounterpartyName(e.target.value)}
                  required
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('accounting:monthClose.confirmDialog.counterpartyCif')} optional>
                  <Input
                    value={counterpartyCif}
                    onChange={(e) => setCounterpartyCif(e.target.value)}
                  />
                </Field>
                <Field
                  label={t('accounting:monthClose.confirmDialog.counterpartyCountry')}
                  optional
                >
                  <Input
                    value={counterpartyCountry}
                    onChange={(e) => setCounterpartyCountry(e.target.value.toUpperCase())}
                    maxLength={2}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('accounting:monthClose.confirmDialog.documentNumber')} optional>
                  <Input
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    maxLength={50}
                  />
                </Field>
                <Field label={t('accounting:monthClose.confirmDialog.issuedAt')}>
                  <Input
                    type="date"
                    value={issuedAt}
                    onChange={(e) => setIssuedAt(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('accounting:monthClose.confirmDialog.amount')}>
                  <Input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('accounting:monthClose.confirmDialog.currency')}>
                  <Select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'RON' | 'EUR' | 'USD')}
                  >
                    <option value="RON">RON</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('accounting:monthClose.confirmDialog.reverseChargeType')}>
                  <Select
                    value={reverseChargeType}
                    onChange={(e) => {
                      const next = e.target.value as ReverseChargeType
                      setReverseChargeType(next)
                      if (next === 'eu_services') setReverseChargeVatRate('21')
                      else if (next === 'non_eu_services') setReverseChargeVatRate('0')
                    }}
                  >
                    <option value="none">{t('accounting:reverseCharge.none')}</option>
                    <option value="eu_services">{t('accounting:reverseCharge.eu')}</option>
                    <option value="non_eu_services">{t('accounting:reverseCharge.nonEu')}</option>
                  </Select>
                </Field>
                {reverseChargeType !== 'none' ? (
                  <Field label={t('accounting:monthClose.confirmDialog.reverseChargeVatRate')}>
                    <Input
                      inputMode="decimal"
                      value={reverseChargeVatRate}
                      onChange={(e) => setReverseChargeVatRate(e.target.value)}
                    />
                  </Field>
                ) : null}
              </div>
            </>
          ) : null}

          {target?.mode === 'fulfill' || target?.mode === 'upload-pdf' ? (
            <Field label={t('accounting:monthClose.confirmDialog.pdfFile')}>
              <Input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                required
              />
            </Field>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                ((target?.mode === 'fulfill' || target?.mode === 'upload-pdf') && !pdfFile)
              }
              data-testid="confirm-supplier-invoice-submit"
            >
              {target?.mode === 'confirm'
                ? t('accounting:monthClose.confirmDialog.submitConfirm')
                : t('accounting:monthClose.confirmDialog.submitFulfill')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
