import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { BillingClient } from '@/shared/lib/types'
import { INVOICING_CLIENTS_KEY } from './records-api'

interface CompanyLookup {
  name: string
  address: { street: string; locality: string; county: string }
  stare: string | null
}

interface NewClientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What was typed in the client search; becomes the name until a lookup replaces it. */
  initialName: string
  onCreated: (client: BillingClient) => void
}

export function NewClientDialog({ open, onOpenChange, initialName, onCreated }: NewClientDialogProps) {
  // Remounted per opening, so the fields start from the typed name every time.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">{open ? <NewClientForm initialName={initialName} onCreated={onCreated} onCancel={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function NewClientForm({ initialName, onCreated, onCancel }: { initialName: string; onCreated: (client: BillingClient) => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [cif, setCif] = useState('')
  const [name, setName] = useState(initialName)
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [county, setCounty] = useState('')
  const [stare, setStare] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // One request per click: the public ANAF source is rate-limited, so typing never triggers it.
  const lookup = useMutation({
    mutationFn: () => api.get<CompanyLookup>(`/api/invoicing/anaf-lookup/${encodeURIComponent(cif.trim())}`),
    onSuccess: (company) => {
      setLookupError(null)
      setName(company.name)
      setStreet(company.address.street)
      setCity(company.address.locality)
      setCounty(company.address.county)
      setStare(company.stare)
    },
    onError: (err) => setLookupError(err.message),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post<BillingClient>('/api/invoicing/clients', {
        name: name.trim(),
        cif: cif.trim(),
        address: street.trim(),
        city: city.trim() || undefined,
        county: county.trim() || undefined,
        country: 'RO',
      }),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
      void queryClient.invalidateQueries({ queryKey: INVOICING_CLIENTS_KEY })
      onCreated(client)
    },
  })

  const addressMissing = submitted && !street.trim()
  const canLookup = cif.trim().length >= 2 && !lookup.isPending

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
        if (!name.trim() || !cif.trim() || !street.trim()) return
        create.mutate()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('accounting:editor.newClient.title')}</DialogTitle>
      </DialogHeader>

      <div className="flex items-end gap-2">
        <Field label={t('common:labels.cif')} className="min-w-0 flex-1">
          <Input value={cif} onChange={(e) => setCif(e.target.value)} autoComplete="off" />
        </Field>
        <Button type="button" variant="outline" disabled={!canLookup} onClick={() => lookup.mutate()}>
          {lookup.isPending ? t('common:states.searching') : t('common:actions.search')}
        </Button>
      </div>
      {lookupError ? <Alert tone="critical">{t('accounting:editor.newClient.lookupFailed', { message: lookupError })}</Alert> : null}
      {stare && stare.toLowerCase() !== 'activ' ? <Alert tone="warning">{t('accounting:editor.newClient.notActive', { stare })}</Alert> : null}

      <Field label={t('accounting:editor.newClient.name')} error={submitted && !name.trim() ? t('accounting:editor.newClient.required') : null}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('common:labels.address')} error={addressMissing ? t('accounting:editor.newClient.addressRequired') : null}>
        <Input value={street} onChange={(e) => setStreet(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common:labels.city')} optional>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label={t('common:labels.county')} optional>
          <Input value={county} onChange={(e) => setCounty(e.target.value)} />
        </Field>
      </div>
      {create.isError ? <Alert tone="critical">{create.error.message}</Alert> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('common:states.saving') : t('accounting:editor.newClient.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
