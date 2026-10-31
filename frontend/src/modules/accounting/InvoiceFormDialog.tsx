import { Money } from '@/shared/components/Money'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { EntityHistory } from '@/shared/components/EntityHistory'
import { api } from '@/shared/lib/api'
import type { BillingClient, FinancialRecord, FinancialRecordDetail, InvoiceTemplate } from '@/shared/lib/types'
import { formatMoney } from './badges'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'

interface LineDraft {
  description: string
  quantity: string
  /** Prețul așa cum îl tastează Stefan — în `priceCurrency`, nu neapărat în moneda facturii. */
  price: string
  /** Valuta lui `price`. '' = aceeași cu moneda facturii (fără conversie). Dacă diferă (EUR/USD
   *  pe o factură în altă monedă), prețul trimis la server e cel convertit prin curs BNR,
   *  calculat live la afișare/salvare — nu se suprascrie ce a tastat Stefan. */
  priceCurrency: 'EUR' | 'USD' | ''
  vatRate: string
}

const EMPTY_LINE: LineDraft = { description: '', quantity: '1', price: '', priceCurrency: '', vatRate: '0' }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface InvoiceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = factură nouă; altfel edit pe draft */
  invoice: FinancialRecord | null
}

export function InvoiceFormDialog({ open, onOpenChange, invoice }: InvoiceFormDialogProps) {
  const queryClient = useQueryClient()
  const [billingClientId, setBillingClientId] = useState('')
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY)
  const [issuedAt, setIssuedAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }])
  const [templateId, setTemplateId] = useState('')

  const clients = useQuery({
    queryKey: ['billing-clients'],
    queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients'),
    enabled: open,
  })

  // Sprint D, Track 3 — picker opțional "alege din template" pt. facturi NOI (editarea
  // unui draft existent pornește oricum din valorile lui reale, nu dintr-un template).
  const templates = useQuery({
    queryKey: ['invoicing', 'clients', billingClientId, 'templates'],
    queryFn: () => api.get<InvoiceTemplate[]>(`/api/invoicing/clients/${billingClientId}/templates`),
    enabled: open && !invoice && Boolean(billingClientId),
  })

  const [resolvingTemplate, setResolvingTemplate] = useState(false)

  // Preț introdus în EUR/USD pe o factură în altă monedă (ex: 200 EUR pe o factură RON) —
  // Stefan tastează suma în valuta lui, nu mai calculează manual conversia. O query per
  // valută (nu una per linie) — cache-uită de react-query, un singur fetch chiar dacă mai
  // multe linii folosesc aceeași valută sursă. `enabled` doar când chiar e nevoie.
  const needsRate = (cur: 'EUR' | 'USD') => currency !== cur && lines.some((l) => l.priceCurrency === cur)
  const eurRate = useQuery({
    queryKey: ['invoicing', 'exchange-rate', 'EUR', issuedAt],
    queryFn: () => api.get<{ date: string; rate: string }>(`/api/invoicing/exchange-rate?currency=EUR&date=${issuedAt}`),
    enabled: open && Boolean(issuedAt) && needsRate('EUR'),
  })
  const usdRate = useQuery({
    queryKey: ['invoicing', 'exchange-rate', 'USD', issuedAt],
    queryFn: () => api.get<{ date: string; rate: string }>(`/api/invoicing/exchange-rate?currency=USD&date=${issuedAt}`),
    enabled: open && Boolean(issuedAt) && needsRate('USD'),
  })

  /** Prețul liniei, convertit la moneda facturii — null dacă are nevoie de un curs BNR care
   *  încă se încarcă (nu blocăm inputul, doar afișarea/salvarea până sosește). */
  function convertedUnitPrice(line: LineDraft): number | null {
    const raw = parseRoDecimal(line.price)
    if (!Number.isFinite(raw)) return 0
    if (!line.priceCurrency || line.priceCurrency === currency) return raw
    const rateQuery = line.priceCurrency === 'EUR' ? eurRate : usdRate
    if (!rateQuery.data) return null
    return raw * Number(rateQuery.data.rate)
  }

  // Liniile "din abonamentul clientului" nu au un unitPrice fix în template — cerem serverului
  // prețul curent (convertit prin curs BNR dacă template-ul e în altă monedă decât abonamentul)
  // ca formularul să prefilleze cifra reală, nu una goală. Draft-ul rămâne editabil după.
  async function applyTemplate(id: string) {
    setTemplateId(id)
    const template = templates.data?.find((template) => template.id === id)
    if (!template) return
    setCurrency(template.currency)
    setResolvingTemplate(true)
    try {
      const resolved = await api.get<{ currency: string; lines: { description: string; quantity: number; unitPrice: number; vatRate: number }[] }>(
        `/api/invoicing/clients/${billingClientId}/templates/${id}/resolve`,
      )
      setLines(
        resolved.lines.map((li) => ({
          description: li.description,
          quantity: String(li.quantity),
          price: String(li.unitPrice),
          priceCurrency: '',
          vatRate: String(li.vatRate),
        })),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accounting:invoiceForm.templatePricesFailed'))
    } finally {
      setResolvingTemplate(false)
    }
  }

  const detail = useQuery({
    queryKey: ['accounting', 'record', invoice?.id],
    queryFn: () => api.get<FinancialRecordDetail>(`/api/accounting/records/${invoice?.id}`),
    enabled: open && Boolean(invoice),
  })

  useEffect(() => {
    if (!open) return
    if (invoice && detail.data) {
      setBillingClientId(detail.data.billingClientId ?? '')
      setCurrency(detail.data.currency)
      setIssuedAt(detail.data.issuedAt.slice(0, 10))
      setDueAt(detail.data.dueAt ? detail.data.dueAt.slice(0, 10) : '')
      setNote(detail.data.description ?? '')
      setLines(
        detail.data.lines.length
          ? detail.data.lines.map((l) => ({
              description: l.description,
              quantity: String(Number(l.quantity)),
              price: String(Number(l.unitPrice)),
              priceCurrency: '' as const,
              vatRate: String(Number(l.vatRate)),
            }))
          : [{ ...EMPTY_LINE }],
      )
    } else if (!invoice) {
      setBillingClientId('')
      setCurrency(BASE_CURRENCY)
      setIssuedAt(new Date().toISOString().slice(0, 10))
      setDueAt('')
      setNote('')
      setLines([{ ...EMPTY_LINE }])
      setTemplateId('')
    }
  }, [open, invoice, detail.data])

  const setLine = (index: number, key: keyof LineDraft, value: string) =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)))

  function setBillingClientAndResetTemplate(id: string) {
    setBillingClientId(id)
    setTemplateId('') // template-urile depind de client — alegerea veche nu se mai aplică
  }

  // null pt. o linie = are un preț în valută al cărui curs BNR încă se încarcă — total
  // aproximativ până sosește, iar trimiterea e blocată (vezi onSubmit) ca să nu emitem cu 0.
  const lineTotals = lines.map((line) => {
    const unit = convertedUnitPrice(line)
    if (unit === null) return null
    const base = (parseRoDecimal(line.quantity) || 0) * unit
    return base * (1 + (parseRoDecimal(line.vatRate) || 0) / 100)
  })
  const totalPending = lineTotals.some((total) => total === null)
  const total = lineTotals.reduce((acc: number, template) => acc + (template ?? 0), 0)

  const save = useMutation({
    mutationFn: () => {
      const body = {
        billingClientId,
        currency,
        issuedAt: issuedAt || undefined,
        dueAt: dueAt || undefined,
        note: note || undefined,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: parseRoDecimal(line.quantity),
          unitPrice: round2(convertedUnitPrice(line) ?? 0),
          vatRate: parseRoDecimal(line.vatRate),
        })),
      }
      return invoice
        ? api.patch<FinancialRecord>(`/api/invoicing/invoices/${invoice.id}`, body)
        : api.post<FinancialRecord>('/api/invoicing/invoices', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(invoice ? t('accounting:invoiceForm.draftUpdated') : t('accounting:invoiceForm.draftCreated'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{invoice ? t('accounting:invoiceForm.editTitle') : t('accounting:invoiceForm.newTitle')}</DialogTitle>
          {invoice ? <EntityHistory entityType="invoice" entityId={invoice.id} /> : null}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!billingClientId) {
              toast.error(t('accounting:invoiceForm.pickClient'))
              return
            }
            if (totalPending) {
              toast.error(t('accounting:invoiceForm.rateStillLoading'))
              return
            }
            save.mutate()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="i-client">{t('common:labels.client')}</Label>
              <Select
                id="i-client"
                value={billingClientId}
                onChange={(e) => setBillingClientAndResetTemplate(e.target.value)}
                required
              >
                <option value="">{t('accounting:invoiceForm.choose')}</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.cif})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-currency">{t('common:labels.currency')}</Label>
              <Select
                id="i-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="RON">RON</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </Select>
            </div>
          </div>

          {!invoice && billingClientId && (templates.data?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="i-template">{t('accounting:invoiceForm.template')}</Label>
              <Select
                id="i-template"
                value={templateId}
                disabled={resolvingTemplate}
                onChange={(e) => void applyTemplate(e.target.value)}
              >
                <option value="">{t('accounting:invoiceForm.noTemplate')}</option>
                {templates.data!.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} {template.isDefaultForAutoInvoice ? t('accounting:invoiceForm.defaultMarker') : ''}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {resolvingTemplate
                  ? t('accounting:invoiceForm.resolvingPrices')
                  : t('accounting:invoiceForm.templateHint')}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="i-issued">{t('accounting:labels.issueDate')}</Label>
              <Input id="i-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-due">{t('accounting:invoiceForm.dueOptional')}</Label>
              <Input id="i-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('accounting:invoiceForm.lines')}</Label>
            <div className="hidden flex-wrap gap-2 text-xs text-muted-foreground sm:flex">
              <div className="sm:min-w-[10rem] sm:flex-1">{t('common:labels.description')}</div>
              <div className="w-16">{t('common:labels.quantityShort')}</div>
              <div className="w-40">{t('accounting:invoiceForm.priceWithCurrency')}</div>
              <div className="w-20">{t('common:labels.vatPercent')}</div>
              <div className="w-9" />
            </div>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex flex-wrap items-start gap-2">
                  <div className="w-full sm:min-w-[10rem] sm:flex-1">
                    <Input
                      placeholder={t('accounting:invoiceForm.lineDescriptionPlaceholder')}
                      value={line.description}
                      onChange={(e) => setLine(i, 'description', e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-16">
                    <Input
                      placeholder={t('common:labels.quantityShort')}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => setLine(i, 'quantity', e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-40 space-y-1">
                    <div className="flex gap-1">
                      <Input
                        placeholder={t('common:labels.price')}
                        inputMode="decimal"
                        value={line.price}
                        onChange={(e) => setLine(i, 'price', e.target.value)}
                        required
                        className="flex-1"
                      />
                      <Select
                        aria-label={t('accounting:invoiceForm.lineCurrencyAria')}
                        className="w-16 shrink-0"
                        value={line.priceCurrency}
                        onChange={(e) => setLine(i, 'priceCurrency', e.target.value)}
                      >
                        <option value="">{currency}</option>
                        {(['EUR', 'USD'] as const)
                          .filter((c) => c !== currency)
                          .map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                      </Select>
                    </div>
                    {line.priceCurrency
                      ? (() => {
                          const rq = line.priceCurrency === 'EUR' ? eurRate : usdRate
                          const converted = convertedUnitPrice(line)
                          if (rq.isPending) return <p className="text-xs text-muted-foreground">{t('accounting:invoiceForm.fetchingRate')}</p>
                          if (converted !== null)
                            return (
                              <p className="text-xs text-muted-foreground">
                                {t('accounting:invoiceForm.converted', { converted: formatMoney(converted, currency), rate: rq.data?.rate, date: rq.data?.date })}
                              </p>
                            )
                          return null
                        })()
                      : null}
                  </div>
                  <div className="w-20">
                    <Input
                      placeholder={t('common:labels.vatPercent')}
                      inputMode="decimal"
                      value={line.vatRate}
                      onChange={(e) => setLine(i, 'vatRate', e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}>
              <Plus className="h-4 w-4" /> {t('accounting:invoiceForm.addLine')}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-note">{t('accounting:invoiceForm.noteOptional')}</Label>
            <Input id="i-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex items-center justify-between border-template pt-4">
            <div className="text-sm text-muted-foreground">
              {t('accounting:invoiceForm.totalWithVat')} <span className="font-semibold text-foreground"><Money amount={total} currency={currency} /></span>
              {totalPending ? <span className="ml-1 text-xs">{t('accounting:invoiceForm.rateLoadingInline')}</span> : null}
            </div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common:states.saving') : invoice ? t('accounting:invoiceForm.saveDraft') : t('accounting:invoiceForm.createDraft')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
