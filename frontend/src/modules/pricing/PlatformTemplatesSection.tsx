import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { InvoiceTemplate } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'

// Sprint D, Track 3; re-scope 2026-07-18 — template-uri de facturi PER PLATFORMĂ (aplicație
// integrată), nu per client: 2-3 template-uri reutilizate de toți clienții unei platforme
// (ex. "Abonament", "Configurare"), în loc de unul dus la fiecare client. Prețul rămâne strict
// pe client — o linie cu sursă "din abonamentul clientului" ia prețul curent al CLIENTULUI ales
// la facturare, nu unul din template.

interface LineDraft {
  description: string
  quantity: string
  priceSource: 'fixed' | 'client_subscription'
  unitPrice: string
  vatRatePct: string
}

const EMPTY_LINE: LineDraft = { description: '', quantity: '1', priceSource: 'fixed', unitPrice: '', vatRatePct: '0' }

interface TemplateFormState {
  name: string
  currency: 'RON' | 'EUR' | 'USD'
  isDefaultForAutoInvoice: boolean
  lines: LineDraft[]
}

function emptyForm(): TemplateFormState {
  return { name: '', currency: 'RON', isDefaultForAutoInvoice: false, lines: [{ ...EMPTY_LINE }] }
}

function toForm(t: InvoiceTemplate): TemplateFormState {
  return {
    name: t.name,
    currency: t.currency,
    isDefaultForAutoInvoice: t.isDefaultForAutoInvoice,
    lines: t.lineItems.map((li) => ({
      description: li.description,
      quantity: String(li.quantity),
      priceSource: li.priceSource,
      unitPrice: li.unitPrice === null ? '' : String(li.unitPrice),
      vatRatePct: String(li.vatRatePct),
    })),
  }
}

export function PlatformTemplatesSection({ platformId }: { platformId: string }) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<TemplateFormState>(emptyForm())

  const templates = useQuery({
    queryKey: ['invoicing', 'platforms', platformId, 'templates'],
    queryFn: () => api.get<InvoiceTemplate[]>(`/api/invoicing/platforms/${platformId}/templates`),
  })

  function startNew() {
    setForm(emptyForm())
    setEditingId('new')
  }

  function startEdit(t: InvoiceTemplate) {
    setForm(toForm(t))
    setEditingId(t.id)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  function setLine(index: number, key: keyof LineDraft, value: string) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, [key]: value } : l)) }))
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['invoicing', 'platforms', platformId, 'templates'] })

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        currency: form.currency,
        isDefaultForAutoInvoice: form.isDefaultForAutoInvoice,
        lineItems: form.lines.map((l) => ({
          description: l.description,
          quantity: parseRoDecimal(l.quantity),
          priceSource: l.priceSource,
          unitPrice: l.priceSource === 'client_subscription' ? null : parseRoDecimal(l.unitPrice),
          vatRatePct: parseRoDecimal(l.vatRatePct),
        })),
      }
      return editingId && editingId !== 'new'
        ? api.patch(`/api/invoicing/platforms/${platformId}/templates/${editingId}`, body)
        : api.post(`/api/invoicing/platforms/${platformId}/templates`, body)
    },
    onSuccess: () => {
      void invalidate()
      toast.success('Template salvat')
      setEditingId(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/invoicing/platforms/${platformId}/templates/${id}`),
    onSuccess: () => {
      void invalidate()
      toast.success('Template șters')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Template-uri de factură (opțional)</Label>
        {editingId === null && (
          <Button type="button" variant="outline" onClick={startNew}>
            <Plus className="h-4 w-4" /> Template nou
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        2-3 template-uri per aplicație (ex. „Abonament", „Configurare"), reutilizate de toți clienții ei — nu unul per
        client. Cel marcat „implicit" e folosit de facturarea automată (cron), pentru ORICE client al acestei
        platforme. O linie „din abonamentul clientului" ia mereu prețul curent al clientului ales la facturare (nu
        unul înghețat aici).
      </p>

      {templates.isPending ? (
        <p className="text-xs text-muted-foreground">Se încarcă…</p>
      ) : templates.data && templates.data.length > 0 ? (
        <div className="space-y-2">
          {templates.data.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{t.name}</span>{' '}
                <span className="text-xs text-muted-foreground">
                  ({t.currency}, {t.lineItems.length} {t.lineItems.length === 1 ? 'linie' : 'linii'})
                </span>
                {t.isDefaultForAutoInvoice && (
                  <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">implicit</span>
                )}
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" onClick={() => startEdit(t)}>
                  Editează
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(t.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        editingId === null && <p className="text-xs text-muted-foreground">Niciun template încă.</p>
      )}

      {editingId !== null && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="t-name">Nume template</Label>
              <Input
                id="t-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="ex: Abonament"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-currency">Monedă</Label>
              <Select
                id="t-currency"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as TemplateFormState['currency'] }))}
              >
                <option value="RON">RON</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Linii</Label>
            <div className="hidden flex-wrap gap-2 text-xs text-muted-foreground sm:flex">
              <div className="sm:min-w-[8rem] sm:flex-1">Descriere</div>
              <div className="w-16">Cant.</div>
              <div className="w-48">Sursă preț</div>
              <div className="w-24">Preț unitar</div>
              <div className="w-16">TVA %</div>
              <div className="w-9" />
            </div>
            {form.lines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="w-full sm:min-w-[8rem] sm:flex-1">
                  <Input
                    placeholder="Descriere"
                    value={line.description}
                    onChange={(e) => setLine(i, 'description', e.target.value)}
                    required
                  />
                </div>
                <div className="w-16">
                  <Input placeholder="Cant." inputMode="decimal" value={line.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} required />
                </div>
                <div className="w-48">
                  <Select
                    value={line.priceSource}
                    onChange={(e) => setLine(i, 'priceSource', e.target.value as LineDraft['priceSource'])}
                  >
                    <option value="fixed">Preț fix</option>
                    <option value="client_subscription">Din abonamentul clientului</option>
                  </Select>
                </div>
                <div className="w-24">
                  {line.priceSource === 'client_subscription' ? (
                    <Input
                      value="auto (abonament)"
                      disabled
                      title="Se ia automat prețul curent al clientului ales la facturare, convertit dacă e nevoie prin cursul BNR al zilei"
                    />
                  ) : (
                    <Input placeholder="Preț unitar" inputMode="decimal" value={line.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} required />
                  )}
                </div>
                <div className="w-16">
                  <Input placeholder="TVA %" inputMode="decimal" value={line.vatRatePct} onChange={(e) => setLine(i, 'vatRatePct', e.target.value)} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={form.lines.length === 1}
                  onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))}>
              <Plus className="h-4 w-4" /> Adaugă linie
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDefaultForAutoInvoice}
              onChange={(e) => setForm((f) => ({ ...f, isDefaultForAutoInvoice: e.target.checked }))}
            />
            Folosește-l implicit la facturarea automată (înlocuiește orice alt template implicit al platformei)
          </label>

          <div className="flex gap-2">
            <Button type="button" disabled={save.isPending || !form.name} onClick={() => save.mutate()}>
              {save.isPending ? 'Se salvează…' : 'Salvează template-ul'}
            </Button>
            <Button type="button" variant="ghost" onClick={cancelEdit}>
              Anulează
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
