import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { FinancialRecord } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'

interface PastRecordFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'out' = factură/încasare emisă de Stefan (tab Emise), 'in' = primită de la un furnizor (tab Primite). */
  direction: 'in' | 'out'
}

const COPY = {
  out: {
    title: t('accounting:past.incomeTitle'),
    helpText:
      t('accounting:past.incomeHint1') +
      t('accounting:past.incomeHint2'),
    counterpartyLabel: 'Client',
    counterpartyPlaceholder: t('accounting:past.clientPlaceholder'),
    secondaryType: { value: 'payment' as const, label: t('accounting:past.paymentNoInvoice') },
    paidLabel: t('accounting:past.alreadyCollected'),
    paidDateLabel: t('accounting:past.collectionDate'),
    defaultPaid: true,
    showCategory: false,
    submitLabel: t('accounting:past.addToArchive'),
  },
  in: {
    title: t('accounting:past.expenseTitle'),
    helpText:
      t('accounting:past.expenseHint1') +
      t('accounting:past.expenseHint2'),
    counterpartyLabel: t('accounting:labels.supplierOptional'),
    counterpartyPlaceholder: t('accounting:past.supplierPlaceholder'),
    secondaryType: { value: 'expense' as const, label: t('accounting:past.expenseNoInvoice') },
    paidLabel: t('accounting:past.alreadyPaid'),
    paidDateLabel: t('accounting:past.paymentDate'),
    defaultPaid: false,
    showCategory: true,
    submitLabel: t('common:actions.add'),
  },
}

// Cheltuieli/facturi primite curente + arhivă (facturi/plăți vechi, dinainte de e-Factura sau
// prin alt canal, care nu pot veni prin sync ANAF) — un singur formular, consolidat din
// fostele ExpenseFormDialog + PastRecordFormDialog (erau aproape identice, doar Furnizor +
// bifa „deja achitată" lipseau din primul). Reutilizează integral endpoint-urile existente
// (POST /records + PATCH /records/:id/payment, path-ul simplu, FĂRĂ side-effect-ul de
// extindere abonament de la /reconciliation/mark-paid — nu are legătură cu un abonament activ).
export function PastRecordFormDialog({ open, onOpenChange, direction }: PastRecordFormDialogProps) {
  const queryClient = useQueryClient()
  const copy = COPY[direction]
  const [type, setType] = useState<'invoice' | 'payment' | 'expense'>('invoice')
  const [counterpartyName, setCounterpartyName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY)
  const [issuedAt, setIssuedAt] = useState('')
  const [paid, setPaid] = useState(copy.defaultPaid)
  const [paidAt, setPaidAt] = useState('')
  // Taxare inversă TVA (Sprint D, Track A) — doar pt. achiziții (direction='in').
  const [reverseChargeType, setReverseChargeType] = useState<'none' | 'eu_services' | 'non_eu_services'>('none')
  const [counterpartyCountry, setCounterpartyCountry] = useState('')
  const [counterpartyCif, setCounterpartyCif] = useState('')
  const [reverseChargeVatRate, setReverseChargeVatRate] = useState('21')

  useEffect(() => {
    if (!open) return
    setType('invoice')
    setCounterpartyName('')
    setDescription('')
    setCategory('')
    setAmount('')
    setCurrency(BASE_CURRENCY)
    const today = new Date().toISOString().slice(0, 10)
    setIssuedAt(today)
    setPaid(copy.defaultPaid)
    setPaidAt(today)
    setReverseChargeType('none')
    setCounterpartyCountry('')
    setCounterpartyCif('')
    setReverseChargeVatRate('21')
  }, [open, copy])

  const save = useMutation({
    mutationFn: async () => {
      const record = await api.post<FinancialRecord>('/api/accounting/records', {
        type,
        direction,
        amount: parseRoDecimal(amount),
        currency,
        description: description || undefined,
        category: copy.showCategory && category ? category : undefined,
        counterpartyName: counterpartyName || undefined,
        issuedAt,
        ...(direction === 'in' && reverseChargeType !== 'none'
          ? {
              reverseChargeType,
              counterpartyCountry: counterpartyCountry || undefined,
              counterpartyCif: counterpartyCif || undefined,
              // 0 e o cotă validă (achiziții non-UE) — omitem DOAR câmpul gol, nu și "0" explicit
              // (schema acceptă .nonnegative(), nu mai cere strict > 0).
              reverseChargeVatRate: reverseChargeVatRate === '' ? undefined : parseRoDecimal(reverseChargeVatRate),
            }
          : {}),
      })
      if (paid) {
        await api.patch<FinancialRecord>(`/api/accounting/records/${record.id}/payment`, {
          paymentStatus: 'paid',
          paidAt: paidAt || issuedAt,
        })
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(t('accounting:past.added'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <p className="text-sm text-muted-foreground">{copy.helpText}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pr-type">{t('common:labels.type')}</Label>
              <Select
                id="pr-type"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="invoice">{t('accounting:labels.invoice')}</option>
                <option value={copy.secondaryType.value}>{copy.secondaryType.label}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-counterparty">{copy.counterpartyLabel}</Label>
              <Input
                id="pr-counterparty"
                value={counterpartyName}
                onChange={(e) => setCounterpartyName(e.target.value)}
                placeholder={copy.counterpartyPlaceholder}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pr-description">{t('accounting:labels.descriptionOptional')}</Label>
              <Input
                id="pr-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={copy.showCategory ? t('accounting:placeholders.awsSubscription') : t('accounting:past.invoiceDescriptionPlaceholder')}
              />
            </div>
            {copy.showCategory ? (
              <div className="space-y-2">
                <Label htmlFor="pr-category">{t('accounting:labels.categoryOptional')}</Label>
                <Input id="pr-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('accounting:placeholders.hosting')} />
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pr-amount">{t('common:labels.amount')}</Label>
              <Input id="pr-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-currency">{t('common:labels.currency')}</Label>
              <Select
                id="pr-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="RON">RON</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-issued">{t('accounting:labels.issueDate')}</Label>
              <Input id="pr-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} required />
            </div>
          </div>
          {direction === 'in' ? (
            <div className="space-y-4 rounded-md border p-3">
              <div className="space-y-2">
                <Label htmlFor="pr-reverse-charge">{t('accounting:reverseCharge.purchaseType')}</Label>
                <Select
                  id="pr-reverse-charge"
                  value={reverseChargeType}
                  onChange={(e) => {
                    const next = e.target.value as typeof reverseChargeType
                    setReverseChargeType(next)
                    // Prefill cotă pe tip — UE 21% (cota standard), non-UE 0% — editabil oricând.
                    if (next === 'eu_services') setReverseChargeVatRate('21')
                    else if (next === 'non_eu_services') setReverseChargeVatRate('0')
                  }}
                >
                  <option value="none">{t('accounting:reverseCharge.none')}</option>
                  <option value="eu_services">{t('accounting:reverseCharge.eu')}</option>
                  <option value="non_eu_services">{t('accounting:reverseCharge.nonEu')}</option>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('accounting:past.reverseChargeHint')}
                </p>
              </div>
              {reverseChargeType !== 'none' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="pr-rc-country">{t('accounting:reverseCharge.supplierCountry')}</Label>
                    <Input
                      id="pr-rc-country"
                      value={counterpartyCountry}
                      onChange={(e) => setCounterpartyCountry(e.target.value.toUpperCase())}
                      placeholder={reverseChargeType === 'eu_services' ? t('accounting:placeholders.countryDe') : t('accounting:placeholders.countryUs')}
                      maxLength={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pr-rc-vatid">{reverseChargeType === 'eu_services' ? t('accounting:reverseCharge.supplierVatCode') : t('accounting:reverseCharge.supplierVatCodeOptional')}</Label>
                    <Input
                      id="pr-rc-vatid"
                      value={counterpartyCif}
                      onChange={(e) => setCounterpartyCif(e.target.value)}
                      placeholder={t('accounting:reverseCharge.noCountryPrefix')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pr-rc-rate">{t('accounting:reverseCharge.vatRate')}</Label>
                    <Input
                      id="pr-rc-rate"
                      inputMode="decimal"
                      value={reverseChargeVatRate}
                      onChange={(e) => setReverseChargeVatRate(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              {copy.paidLabel}
            </label>
            {paid ? (
              <div className="space-y-2">
                <Label htmlFor="pr-paid-at">{copy.paidDateLabel}</Label>
                <Input id="pr-paid-at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common:states.saving') : copy.submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
