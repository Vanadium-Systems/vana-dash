import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { api, ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { errorCode } from './use-prospect-actions'

export interface NewProspectSeed {
  name?: string
  cui?: string
}

interface Existing {
  id: string
  name: string
  ownerName?: string | null
}

interface LookupResult {
  company: { name: string; address: { street: string | null; locality: string | null; county: string | null }; caen: string | null; isActive: boolean }
  existing: Existing | null
}

const addressLine = (address: LookupResult['company']['address']) => [address.street, address.locality, address.county].filter(Boolean).join(', ')

/** CUI first: the register fills the name, and a company that is already a prospect is shown instead of duplicated. */
export function NewProspectDialog({ seed, onOpenChange, onOpenProspect }: { seed: NewProspectSeed | null; onOpenChange: (open: boolean) => void; onOpenProspect: (id: string) => void }) {
  const queryClient = useQueryClient()
  const open = seed !== null
  const [cui, setCui] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [caen, setCaen] = useState('')
  const [existing, setExisting] = useState<Existing | null>(null)
  const [cuiError, setCuiError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const lookedUp = useRef('')

  const lookup = async (value: string) => {
    const typed = value.trim()
    if (typed.length < 2 || typed === lookedUp.current) return
    lookedUp.current = typed
    setLooking(true)
    setCuiError(null)
    try {
      const { company, existing: found } = await api.get<LookupResult>(`/api/prospects/company-lookup?cui=${encodeURIComponent(typed)}`)
      setExisting(found)
      setName((current) => current || company.name)
      setAddress(addressLine(company.address))
      setCaen(company.caen ?? '')
      if (!company.isActive) setCuiError(t('clients:prospects.new.inactive'))
    } catch (err) {
      setExisting(null)
      setAddress('')
      setCaen('')
      // 404 = this country has no register lookup: the form simply stays manual.
      if (!(err instanceof ApiError && err.status === 404)) setCuiError(err instanceof Error ? err.message : t('clients:prospects.new.lookupFailed'))
    } finally {
      setLooking(false)
    }
  }

  useEffect(() => {
    if (!seed) return
    setCui(seed.cui ?? '')
    setName(seed.name ?? '')
    setPhone('')
    setEmail('')
    setAddress('')
    setCaen('')
    setExisting(null)
    setCuiError(null)
    setNameError(null)
    lookedUp.current = ''
    if (seed.cui) void lookup(seed.cui)
    // Runs when the dialog opens with a seed, not when `lookup` is recreated.
  }, [seed])

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; name: string }>('/api/prospects', {
        name: name.trim(),
        ...(cui.trim() ? { cif: cui.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(caen ? { caenCode: caen } : {}),
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      toast.success(t('clients:prospects.new.created', { name: row.name }), { action: { label: t('common:actions.open'), onClick: () => onOpenProspect(row.id) } })
      onOpenChange(false)
    },
    onError: (err) => {
      const found = (err instanceof ApiError ? (err.body as { existing?: Existing } | undefined)?.existing : undefined) ?? null
      if (errorCode(err) === 'PROSPECT_EXISTS' && found) setExisting(found)
      else toast.error(err.message)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:prospects.new.title')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (existing) return
            if (!name.trim()) return setNameError(t('clients:prospects.new.nameRequired'))
            create.mutate()
          }}
        >
          <Field label={t('clients:prospects.new.cui')} optional error={cuiError} hint={looking ? t('clients:prospects.new.looking') : undefined}>
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              value={cui}
              onChange={(e) => setCui(e.target.value)}
              onBlur={(e) => void lookup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void lookup(e.currentTarget.value)
                }
              }}
            />
          </Field>
          {existing ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span>{existing.ownerName ? t('clients:prospects.new.existsOwner', { name: existing.name, owner: existing.ownerName }) : t('clients:prospects.new.exists', { name: existing.name })}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  onOpenProspect(existing.id)
                }}
              >
                {t('common:actions.open')}
              </Button>
            </div>
          ) : null}
          <Field label={t('clients:prospects.new.name')} error={nameError} hint={address || undefined}>
            <Input value={name} maxLength={255} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common:labels.phone')} optional>
              <Input type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={t('common:labels.email')} optional>
              <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || Boolean(existing)}>
              {t('clients:prospects.new.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
