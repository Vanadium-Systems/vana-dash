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

interface PastRecordFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'out' = factură/încasare emisă de Stefan (tab Emise), 'in' = primită de la un furnizor (tab Primite). */
  direction: 'in' | 'out'
}

const COPY = {
  out: {
    title: 'Factură/încasare veche (arhivă)',
    helpText:
      'Pt. facturi/încasări din trecut care nu sunt în e-Factura și nu pot veni prin sync ANAF — doar evidență, ' +
      'nu generează XML/PDF și nu se trimite nicăieri.',
    counterpartyLabel: 'Client',
    counterpartyPlaceholder: 'ex: Firma Client SRL',
    secondaryType: { value: 'payment' as const, label: 'Încasare (fără factură)' },
    paidLabel: 'Deja încasată',
    paidDateLabel: 'Data încasării',
    defaultPaid: true,
    showCategory: false,
    submitLabel: 'Adaugă în arhivă',
  },
  in: {
    title: 'Cheltuială / factură primită',
    helpText:
      'Pt. cheltuieli curente sau facturi primite de la furnizori care nu sunt (sau nu vor fi) în e-Factura — ' +
      'nu generează nimic, doar evidență. Bifează „deja achitată" doar dacă e cazul.',
    counterpartyLabel: 'Furnizor (opțional)',
    counterpartyPlaceholder: 'ex: Furnizor SRL',
    secondaryType: { value: 'expense' as const, label: 'Cheltuială (fără factură)' },
    paidLabel: 'Deja achitată',
    paidDateLabel: 'Data plății',
    defaultPaid: false,
    showCategory: true,
    submitLabel: 'Adaugă',
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
  const [currency, setCurrency] = useState('RON')
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
    setCurrency('RON')
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
      toast.success('Înregistrare adăugată în arhivă')
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
              <Label htmlFor="pr-type">Tip</Label>
              <Select
                id="pr-type"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="invoice">Factură</option>
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
              <Label htmlFor="pr-description">Descriere (opțional)</Label>
              <Input
                id="pr-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={copy.showCategory ? 'ex: Abonament AWS' : 'ex: Factura F-2025-014, emisă manual'}
              />
            </div>
            {copy.showCategory ? (
              <div className="space-y-2">
                <Label htmlFor="pr-category">Categorie (opțional)</Label>
                <Input id="pr-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="ex: hosting" />
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pr-amount">Sumă</Label>
              <Input id="pr-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-currency">Monedă</Label>
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
              <Label htmlFor="pr-issued">Data emiterii</Label>
              <Input id="pr-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} required />
            </div>
          </div>
          {direction === 'in' ? (
            <div className="space-y-4 rounded-md border p-3">
              <div className="space-y-2">
                <Label htmlFor="pr-reverse-charge">Tip achiziție (taxare inversă TVA)</Label>
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
                  <option value="none">Fără taxare inversă</option>
                  <option value="eu_services">UE — servicii (ex: Hetzner)</option>
                  <option value="non_eu_services">Non-UE — servicii (ex: Cloudflare)</option>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Apare în declarația D301 a lunii facturii (câmp „Data emiterii" de mai sus). Achizițiile UE apar și
                  în D390.
                </p>
              </div>
              {reverseChargeType !== 'none' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="pr-rc-country">Țara furnizorului (ISO-2)</Label>
                    <Input
                      id="pr-rc-country"
                      value={counterpartyCountry}
                      onChange={(e) => setCounterpartyCountry(e.target.value.toUpperCase())}
                      placeholder={reverseChargeType === 'eu_services' ? 'ex: DE' : 'ex: US'}
                      maxLength={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pr-rc-vatid">Cod TVA furnizor{reverseChargeType === 'eu_services' ? '' : ' (opțional)'}</Label>
                    <Input
                      id="pr-rc-vatid"
                      value={counterpartyCif}
                      onChange={(e) => setCounterpartyCif(e.target.value)}
                      placeholder="fără prefix de țară"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pr-rc-rate">Cotă TVA (%)</Label>
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
              Anulează
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Se salvează…' : copy.submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
