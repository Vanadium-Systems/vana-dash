import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { EntityHistory } from '@/shared/components/EntityHistory'
import { api } from '@/shared/lib/api'
import type { AnafCompanyInfo, BillingClient, ContractDetails, Platform, PricingConfigRow, ReservedContractNumber, VanagreenTenant } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'

interface ClientFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create */
  client: BillingClient | null
}

const ROMANIAN_MONTHS = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
]

// Contracts imported from the older system have the date written as "4 iunie 2026" —
// parsăm și formatul ăsta, ca inputul de dată nativ să nu arate gol la prima editare.
export function parseContractDate(s: string): string {
  const ddmm = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim())
  if (ddmm) return `${ddmm[3]}-${ddmm[2]}-${ddmm[1]}`
  const ro = /^(\d{1,2})\s+([a-zăâîșț]+)\s+(\d{4})$/i.exec(s.trim())
  if (ro) {
    const monthIdx = ROMANIAN_MONTHS.indexOf(ro[2]!.toLowerCase())
    if (monthIdx >= 0) return `${ro[3]}-${String(monthIdx + 1).padStart(2, '0')}-${ro[1]!.padStart(2, '0')}`
  }
  return ''
}

export function formatContractDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

// Contract numbers run globally (001, 002, 003…, in the order clients are onboarded), not per
// client like addenda. This is only a suggestion and can be overwritten by hand. Reserved
// numbers (contracts made outside the app) are skipped.
export function suggestNextContractNumber(
  clients: BillingClient[] | undefined,
  reserved: ReservedContractNumber[] = [],
): string {
  const used = (clients ?? [])
    .map((c) => c.contractDetails?.nrContract)
    .filter((v): v is string => Boolean(v))
    .map((v) => parseInt(v, 10))
    .filter((n) => !Number.isNaN(n))
  const taken = new Set(reserved.map((r) => parseInt(r.number, 10)))
  let next = (used.length > 0 ? Math.max(...used) : 0) + 1
  while (taken.has(next)) next += 1
  return String(next).padStart(3, '0')
}

/** Mesajul de sub câmp când numărul tastat e deja rezervat sau pus pe alt client; altfel null. */
export function contractNumberConflict(
  value: string | undefined,
  clients: BillingClient[] | undefined,
  reserved: ReservedContractNumber[],
  currentClientId: string | null,
): string | null {
  const typed = (value ?? '').trim()
  if (!/^\d+$/.test(typed)) return null
  const n = parseInt(typed, 10)
  const label = typed.padStart(3, '0')
  const hit = reserved.find((r) => parseInt(r.number, 10) === n)
  if (hit) return `${label} e rezervat: ${hit.note}`
  const owner = (clients ?? []).find(
    (c) => c.id !== currentClientId && /^\d+$/.test(c.contractDetails?.nrContract?.trim() ?? '') && parseInt(c.contractDetails!.nrContract!, 10) === n,
  )
  return owner ? `${label} e deja folosit la ${owner.name}` : null
}

export function ClientFormDialog({ open, onOpenChange, client }: ClientFormDialogProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: '',
    slug: '',
    cif: '',
    regCom: '',
    address: '',
    city: '',
    county: '',
    iban: '',
    bank: '',
    email: '',
  })
  const [platformId, setPlatformId] = useState('')
  const [vanagreenTenantId, setVanagreenTenantId] = useState('')
  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false)
  const [vanagreenExtendMonths, setVanagreenExtendMonths] = useState('')
  const [subscriptionPriceCurrency, setSubscriptionPriceCurrency] = useState<'lei' | 'eur'>('lei')
  const [subscriptionPriceAmount, setSubscriptionPriceAmount] = useState('')
  const [autoInvoiceEnabled, setAutoInvoiceEnabled] = useState(false)
  // Sprint C, Track D — cadență de facturare recurentă, mutată din vanagreen.
  const [billingCycle, setBillingCycle] = useState<'' | 'monthly' | 'annual'>('')
  const [billingCycleDay, setBillingCycleDay] = useState('')
  const [billingCycleMonth, setBillingCycleMonth] = useState('')
  const [billingDueDate, setBillingDueDate] = useState('')
  const [paymentTermsDays, setPaymentTermsDays] = useState('')
  const [needsBillingInfo, setNeedsBillingInfo] = useState(false)
  // Doar la creare — checkbox "și în VanaGreen" (default OFF, nu toți clienții au legătură).
  const [createInVanagreen, setCreateInVanagreen] = useState(false)
  // Sprint Tab Contracte — câmpuri fixe (coloane billing_clients) + restul, text liber (jsonb).
  const [contactName, setContactName] = useState('')
  const [contactTitle, setContactTitle] = useState('')
  const [contractPhone, setContractPhone] = useState('')
  const [contractPlan, setContractPlan] = useState('')
  const [contractDetails, setContractDetails] = useState<ContractDetails>({})
  const [contractDateIso, setContractDateIso] = useState('')
  const [facturareTipOther, setFacturareTipOther] = useState('')
  const [moduleAddonSelected, setModuleAddonSelected] = useState<string[]>([])
  const [moduleAddonOther, setModuleAddonOther] = useState('')
  const cd = (key: keyof ContractDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setContractDetails((d) => ({ ...d, [key]: e.target.value }))

  // Aceeași listă deja încărcată de ClientsTab (React Query dedup pe queryKey) — folosită doar
  // pt. sugestia de „Număr contract" (max existent + 1).
  const clients = useQuery({
    queryKey: ['billing-clients'],
    queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients'),
    enabled: open,
  })

  // Fără `enabled: open`: lista trebuie să fie deja în cache când se deschide dialogul, altfel
  // prima sugestie pleacă fără ea. Cine nu are `facturi.contracte` primește 403 și rămâne cu [].
  const reservedNumbers = useQuery({
    queryKey: ['contract-reserved-numbers'],
    queryFn: () => api.get<ReservedContractNumber[]>('/api/contracts/reserved-numbers'),
    retry: false,
  })

  // Listă goală (fără eroare) dacă platforma vanagreen nu e configurată încă — dropdown-ul
  // devine pur decorativ, id-ul se introduce manual (validat oricum la salvare).
  const vanagreenTenants = useQuery({
    queryKey: ['vanagreen-tenants'],
    queryFn: () => api.get<VanagreenTenant[]>('/api/reconciliation/vanagreen-tenants'),
    enabled: open,
  })

  const platforms = useQuery({
    queryKey: ['platforms'],
    queryFn: () => api.get<Platform[]>('/api/platforms'),
    enabled: open,
  })

  // Wave 0/1, sprint de-hardcodare (2026-08-20) — aceeași sursă ca ConfigPretTab (catalogul de
  // add-on-uri al platformei), în loc de MODULE_ADDON_OPTIONS hardcodat (era doar 5/12,
  // inconsistent cu Config preț). Gol dacă clientul nu e mapat la nicio platformă încă.
  const pricingConfig = useQuery({
    queryKey: ['pricing', 'config', platformId],
    queryFn: () => api.get<PricingConfigRow | null>(`/api/pricing/config?platformId=${platformId}`),
    enabled: open && Boolean(platformId),
  })
  const moduleAddonOptions = pricingConfig.data?.config.addons.map((a) => a.label) ?? []
  // Plan (2026-09-21) — dropdown-ul cu 2 opțiuni fixe ("Standard"/"Privat") înlocuit cu
  // pachetele reale din Config preț (ConfigPretTab, aceeași sursă ca `pricingConfig` de mai
  // sus) + "Privat" pt. condiții negociate individual. Alegerea unui pachet bifează automat
  // modulele lui și completează prețul — Stefan nu le mai duplică manual la fiecare client nou.
  const bundles = pricingConfig.data?.config.bundles ?? []
  const addonLabelByKey = new Map((pricingConfig.data?.config.addons ?? []).map((a) => [a.key, a.label]))

  function selectContractPlan(planLabel: string) {
    setContractPlan(planLabel)
    const bundle = bundles.find((b) => b.label === planLabel)
    if (!bundle) return
    setModuleAddonSelected(bundle.addonKeys.map((k) => addonLabelByKey.get(k)).filter((l): l is string => Boolean(l)))
    setSubscriptionPriceCurrency('lei')
    setSubscriptionPriceAmount(String(bundle.price))
  }

  useEffect(() => {
    if (open) {
      setForm({
        name: client?.name ?? '',
        slug: client?.slug ?? '',
        cif: client?.cif ?? '',
        regCom: client?.regCom ?? '',
        address: client?.address ?? '',
        city: client?.city ?? '',
        county: client?.county ?? '',
        iban: client?.iban ?? '',
        bank: client?.bank ?? '',
        email: client?.email ?? '',
      })
      setPlatformId(client?.platformId ?? '')
      setVanagreenTenantId(client?.vanagreenTenantId ?? '')
      setVanagreenExtendMonths(client?.vanagreenExtendMonths ? String(client.vanagreenExtendMonths) : '')
      setSubscriptionPriceCurrency(client?.subscriptionPriceCurrency ?? 'lei')
      const amount =
        client?.subscriptionPriceCurrency === 'eur' ? client?.subscriptionPriceEur : client?.subscriptionPriceLei
      setSubscriptionPriceAmount(amount ?? '')
      setAutoInvoiceEnabled(client?.autoInvoiceEnabled ?? false)
      setBillingCycle(client?.billingCycle ?? '')
      setBillingCycleDay(client?.billingCycleDay ? String(client.billingCycleDay) : '')
      setBillingCycleMonth(client?.billingCycleMonth ? String(client.billingCycleMonth) : '')
      setBillingDueDate(client?.billingDueDate ?? '')
      setPaymentTermsDays(client?.paymentTermsDays != null ? String(client.paymentTermsDays) : '')
      setNeedsBillingInfo(client?.needsBillingInfo ?? false)
      setCreateInVanagreen(false)
      setContactName(client?.contactName ?? '')
      setContactTitle(client?.contactTitle ?? '')
      setContractPhone(client?.phone ?? '')
      setContractPlan(client?.contractPlan ?? '')
      const details = client?.contractDetails ?? {}
      setContractDetails(
        !details.nrContract ? { ...details, nrContract: suggestNextContractNumber(clients.data, reservedNumbers.data) } : details,
      )
      setContractDateIso(details.dataContract ? parseContractDate(details.dataContract) : '')
      // "Ciclu de facturare": select LUNAR/ANUAL/SPECIAL — orice altă valoare existentă (text
      // liber vechi) intră automat pe "SPECIAL" cu textul păstrat, nu se pierde la editare.
      setFacturareTipOther(
        details.facturareTip && details.facturareTip !== 'LUNAR' && details.facturareTip !== 'ANUAL'
          ? details.facturareTip
          : '',
      )
    }
    // clients.data intenționat exclus din deps — doar pt. sugestia de nr. contract la
    // deschidere, nu vrem re-rulare la fiecare refetch în fundal.
  }, [open, client])

  // Lista de rezervate sosită după deschidere: sugestia se recalculează doar dacă omul n-a
  // atins câmpul (valoarea e încă sugestia făcută fără listă).
  useEffect(() => {
    if (!open || client?.contractDetails?.nrContract || !reservedNumbers.data) return
    setContractDetails((current) =>
      current.nrContract === suggestNextContractNumber(clients.data)
        ? { ...current, nrContract: suggestNextContractNumber(clients.data, reservedNumbers.data) }
        : current,
    )
  }, [reservedNumbers.data])

  // "Module add-on active": checkbox-uri din catalogul platformei + reziduu text liber pt.
  // valori vechi care nu se mapează 1:1 (ex: "E-Factura (ANAF SPV)", importat din
  // recyclers_app) — păstrat, nu pierdut la prima editare. Efect SEPARAT (nu în cel de mai sus):
  // `moduleAddonOptions` vine din pricingConfig, care se rezolvă async DUPĂ ce platformId e
  // setat în efectul de mai sus — reclasificarea trebuie să ruleze din nou când sosește.
  useEffect(() => {
    if (!open) return
    const existingAddons = (client?.contractDetails?.moduleAddon ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setModuleAddonSelected(existingAddons.filter((a) => moduleAddonOptions.includes(a)))
    setModuleAddonOther(existingAddons.filter((a) => !moduleAddonOptions.includes(a)).join(', '))
  }, [open, client, moduleAddonOptions.join('|')])

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  // Sugestie de mapare: tenant-urile vanagreen cu numele cel mai apropiat de client sus.
  const sortedTenants = [...(vanagreenTenants.data ?? [])].sort((a, b) => {
    const name = form.name.trim().toLowerCase()
    const aMatch = name && a.name.toLowerCase().includes(name) ? 0 : 1
    const bMatch = name && b.name.toLowerCase().includes(name) ? 0 : 1
    return aMatch - bMatch || a.name.localeCompare(b.name)
  })

  // Odată ales, arătăm numele (nu id-ul brut) ca și confirmare vizuală a selecției.
  const selectedTenant = vanagreenTenants.data?.find((t) => t.id === vanagreenTenantId)

  // Căutare client-side, capată la 8 rezultate — cu 100+ clienți vanagreen, o listă plată
  // nefiltrată devine imposibil de răsfoit manual (semnalat de Stefan). Tastarea îngustează.
  const filteredTenants = sortedTenants
    .filter((t) => {
      const q = tenantSearch.trim().toLowerCase()
      if (!q) return true
      return t.name.toLowerCase().includes(q) || (t.cif ?? '').toLowerCase().includes(q)
    })
    .slice(0, 8)

  const verifyTenant = useMutation({
    mutationFn: () =>
      api.post<{ exists: boolean }>('/api/reconciliation/vanagreen-tenants/verify', { tenantId: vanagreenTenantId }),
    onSuccess: ({ exists }) => {
      if (exists) toast.success('Tenant găsit în vanagreen')
      else toast.error('Niciun tenant vanagreen cu acest id')
    },
    onError: (err) => toast.error(err.message),
  })

  // Completare automată din ANAF după CIF — nume, adresă, oraș, județ (text liber, ca
  // înainte — countyNameToIsoCode la emitere face maparea la codul ISO 3166-2:RO).
  const anafLookup = useMutation({
    mutationFn: () => api.get<AnafCompanyInfo>(`/api/invoicing/anaf-lookup/${encodeURIComponent(form.cif)}`),
    onSuccess: (info) => {
      setForm((f) => ({
        ...f,
        name: info.name,
        address: info.address.street ?? f.address,
        city: info.address.locality ?? f.city,
        county: info.address.county ?? f.county,
      }))
      if (info.stare !== 'activ') toast.warning(`Firmă găsită, dar stare ANAF: ${info.stare}`)
      else toast.success('Date completate din ANAF')
    },
    onError: (err) => toast.error(err.message),
  })

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: form.name, cif: form.cif, address: form.address }
      if (form.slug) body.slug = form.slug
      if (form.regCom) body.regCom = form.regCom
      if (form.city) body.city = form.city
      if (form.county) body.county = form.county
      if (form.iban) body.iban = form.iban
      if (form.bank) body.bank = form.bank
      if (form.email) body.email = form.email
      body.platformId = platformId || null
      body.vanagreenTenantId = vanagreenTenantId || null
      body.vanagreenExtendMonths = vanagreenExtendMonths ? parseRoDecimal(vanagreenExtendMonths) : null
      body.subscriptionPriceCurrency = subscriptionPriceCurrency
      body.subscriptionPriceLei = subscriptionPriceCurrency === 'lei' && subscriptionPriceAmount ? parseRoDecimal(subscriptionPriceAmount) : null
      body.subscriptionPriceEur = subscriptionPriceCurrency === 'eur' && subscriptionPriceAmount ? parseRoDecimal(subscriptionPriceAmount) : null
      body.autoInvoiceEnabled = autoInvoiceEnabled
      body.billingCycle = billingCycle || null
      body.billingCycleDay = billingCycle && billingCycleDay ? parseRoDecimal(billingCycleDay) : null
      body.billingCycleMonth = billingCycle === 'annual' && billingCycleMonth ? parseRoDecimal(billingCycleMonth) : null
      body.billingDueDate = billingDueDate || null
      body.paymentTermsDays = paymentTermsDays ? parseRoDecimal(paymentTermsDays) : null
      if (client) body.needsBillingInfo = needsBillingInfo
      if (!client) body.createInVanagreen = createInVanagreen
      body.contactName = contactName || null
      body.contactTitle = contactTitle || null
      body.phone = contractPhone || null
      body.contractPlan = contractPlan || null
      const moduleAddon = [...moduleAddonSelected, ...(moduleAddonOther ? [moduleAddonOther] : [])].join(', ') || undefined
      const finalContractDetails: ContractDetails = {
        ...contractDetails,
        dataContract: contractDateIso ? formatContractDate(contractDateIso) : contractDetails.dataContract,
        facturareTip: contractDetails.facturareTip === 'SPECIAL' ? facturareTipOther : contractDetails.facturareTip,
        moduleAddon,
      }
      body.contractDetails = Object.keys(finalContractDetails).some((k) => finalContractDetails[k as keyof ContractDetails])
        ? finalContractDetails
        : null
      return client
        ? api.patch<BillingClient>(`/api/invoicing/clients/${client.id}`, body)
        : api.post<BillingClient>('/api/invoicing/clients', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
      toast.success(client ? 'Client actualizat' : 'Client adăugat')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const nrContractConflict = contractNumberConflict(contractDetails.nrContract, clients.data, reservedNumbers.data ?? [], client?.id ?? null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? 'Editează clientul' : 'Adaugă client'}</DialogTitle>
          <EntityHistory entityType="billing_client" entityId={client?.id} />
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          {client?.needsBillingInfo && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning dark:bg-transparent">
              <p className="font-medium">Client creat automat din VanaGreen — completează datele de facturare.</p>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={needsBillingInfo} onChange={(e) => setNeedsBillingInfo(e.target.checked)} />
                Marchează încă „date incomplete" (debifează la salvare dacă ai completat tot)
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-name">Denumire</Label>
              <Input id="c-name" value={form.name} onChange={set('name')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-slug">Slug</Label>
              <Input id="c-slug" value={form.slug} onChange={set('slug')} placeholder="auto din denumire dacă lași gol" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-cif">CIF</Label>
              <div className="flex gap-2">
                <Input id="c-cif" value={form.cif} onChange={set('cif')} required />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!form.cif || anafLookup.isPending}
                  onClick={() => anafLookup.mutate()}
                >
                  {anafLookup.isPending ? 'Caut…' : 'Caută la ANAF'}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-regcom">Reg. Com. (opțional)</Label>
              <Input id="c-regcom" value={form.regCom} onChange={set('regCom')} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-address">Adresă</Label>
            <Input id="c-address" value={form.address} onChange={set('address')} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="c-city">Oraș</Label>
              <Input id="c-city" value={form.city} onChange={set('city')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-county">Județ</Label>
              <Input id="c-county" value={form.county} onChange={set('county')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={form.email} onChange={set('email')} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-iban">IBAN (pt. matching)</Label>
              <Input id="c-iban" value={form.iban} onChange={set('iban')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-bank">Bancă</Label>
              <Input id="c-bank" value={form.bank} onChange={set('bank')} />
            </div>
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="c-platform">Aplicație integrată (opțional)</Label>
            <Select
              id="c-platform"
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
            >
              <option value="">— nicio platformă (facturare strict manuală) —</option>
              {(platforms.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Determină ce template-uri de factură (Pricing → Template-uri) sunt disponibile pentru acest client.
            </p>
          </div>

          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-semibold">Vanagreen (opțional)</Label>
            {!client && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createInVanagreen}
                  onChange={(e) => {
                    setCreateInVanagreen(e.target.checked)
                    if (e.target.checked) setVanagreenTenantId('')
                  }}
                />
                Creează și în VanaGreen (tenant nou, folosește slug-ul de mai sus)
              </label>
            )}
            <div className="space-y-2">
              <Label htmlFor="c-vanagreen-search">Sugestie tenant existent</Label>
              {selectedTenant ? (
                <div className="flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
                  <span>
                    {selectedTenant.name} {selectedTenant.cif ? `(${selectedTenant.cif})` : ''}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={createInVanagreen}
                    onClick={() => {
                      setVanagreenTenantId('')
                      setTenantSearch('')
                    }}
                  >
                    Schimbă
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    id="c-vanagreen-search"
                    value={tenantSearch}
                    onChange={(e) => {
                      setTenantSearch(e.target.value)
                      setTenantDropdownOpen(true)
                    }}
                    onFocus={() => setTenantDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setTenantDropdownOpen(false), 150)}
                    placeholder="Caută după nume sau CIF…"
                    disabled={createInVanagreen}
                  />
                  {tenantDropdownOpen && !createInVanagreen && (
                    <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-input bg-popover shadow-md">
                      {filteredTenants.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Niciun rezultat</div>
                      ) : (
                        filteredTenants.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                            // onMouseDown (nu onClick) — se declanșează ÎNAINTE de onBlur-ul
                            // input-ului, altfel dropdown-ul se închide înainte să înregistrăm click-ul.
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setVanagreenTenantId(t.id)
                              setTenantSearch('')
                              setTenantDropdownOpen(false)
                            }}
                          >
                            {t.name} {t.cif ? `(${t.cif})` : ''}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="c-vanagreen-id">Tenant ID vanagreen (existent)</Label>
                <Input
                  id="c-vanagreen-id"
                  value={vanagreenTenantId}
                  onChange={(e) => setVanagreenTenantId(e.target.value)}
                  placeholder="uuid tenant din vanagreen"
                  disabled={createInVanagreen}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!vanagreenTenantId || createInVanagreen || verifyTenant.isPending}
                onClick={() => verifyTenant.mutate()}
              >
                Verifică
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-extend-months">Luni de extins la o plată confirmată</Label>
              <Input
                id="c-extend-months"
                inputMode="numeric"
                value={vanagreenExtendMonths}
                onChange={(e) => setVanagreenExtendMonths(e.target.value)}
                placeholder="ex: 1"
              />
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-semibold">Cadență facturare (opțional)</Label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="c-cycle-type">Tip</Label>
                <Select
                  id="c-cycle-type"
                  value={billingCycle}
                  onChange={(e) => setBillingCycle(e.target.value as '' | 'monthly' | 'annual')}
                >
                  <option value="">Fără (dată fixă, fără rostogolire)</option>
                  <option value="monthly">Lunar</option>
                  <option value="annual">Anual</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-cycle-day">Ziua din lună</Label>
                <Input
                  id="c-cycle-day"
                  inputMode="numeric"
                  value={billingCycleDay}
                  onChange={(e) => setBillingCycleDay(e.target.value)}
                  disabled={!billingCycle}
                />
              </div>
              {billingCycle === 'annual' && (
                <div className="space-y-2">
                  <Label htmlFor="c-cycle-month">Luna</Label>
                  <Input
                    id="c-cycle-month"
                    inputMode="numeric"
                    value={billingCycleMonth}
                    onChange={(e) => setBillingCycleMonth(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-due-date">Scadență curentă</Label>
              <Input id="c-due-date" type="date" value={billingDueDate} onChange={(e) => setBillingDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-payment-terms">Termen de plată (zile, excepție)</Label>
              <Input
                id="c-payment-terms"
                inputMode="numeric"
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                placeholder="implicit din setări"
              />
              <p className="text-xs text-muted-foreground">
                Scadența facturii (issuedAt + acest termen). Gol = folosește default-ul global (Setări → Secvență).
                Setează doar dacă acest client are un contract cu termen diferit.
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-semibold">Facturare automată (opțional)</Label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-price-currency">Monedă preț abonament</Label>
                <Select
                  id="c-price-currency"
                  value={subscriptionPriceCurrency}
                  onChange={(e) => setSubscriptionPriceCurrency(e.target.value as 'lei' | 'eur')}
                >
                  <option value="lei">Lei (RON)</option>
                  <option value="eur">EUR</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-price-amount">Preț abonament</Label>
                <Input
                  id="c-price-amount"
                  inputMode="decimal"
                  value={subscriptionPriceAmount}
                  onChange={(e) => setSubscriptionPriceAmount(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoInvoiceEnabled}
                onChange={(e) => setAutoInvoiceEnabled(e.target.checked)}
                disabled={!vanagreenTenantId}
              />
              Emite factura automat la scadența de mai sus (cere tenant mapat mai sus)
            </label>
          </div>

          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-semibold">Date contract (opțional, pt. tab Contracte)</Label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ct-contact-name">Reprezentant client</Label>
                <Input id="ct-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="ex: Ion Popescu" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-contact-title">Funcție reprezentant</Label>
                <Input id="ct-contact-title" value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} placeholder="ex: Administrator" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-phone">Telefon client</Label>
                <Input id="ct-phone" value={contractPhone} onChange={(e) => setContractPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-plan">Plan</Label>
                <Select
                  id="ct-plan"
                  value={contractPlan}
                  onChange={(e) => selectContractPlan(e.target.value)}
                >
                  <option value="">—</option>
                  {bundles.map((b) => (
                    <option key={b.key} value={b.label}>
                      {b.label}
                    </option>
                  ))}
                  <option value="Privat">Privat</option>
                  {contractPlan && contractPlan !== 'Privat' && !bundles.some((b) => b.label === contractPlan) && (
                    <option value={contractPlan}>{contractPlan} (vechi)</option>
                  )}
                </Select>
                {bundles.some((b) => b.label === contractPlan) && (
                  <p className="text-xs text-muted-foreground">Module și preț completate automat din pachet — editabile mai jos.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-nr-contract">Număr contract</Label>
                <Input
                  id="ct-nr-contract"
                  value={contractDetails.nrContract ?? ''}
                  onChange={cd('nrContract')}
                  placeholder="ex: 003"
                  aria-describedby="ct-nr-contract-hint"
                />
                {nrContractConflict ? (
                  <p id="ct-nr-contract-hint" className="text-xs text-warning">{nrContractConflict}</p>
                ) : (
                  <p id="ct-nr-contract-hint" className="text-xs text-muted-foreground">Sugerat automat (ultimul + 1, fără cele rezervate) — suprascrie dacă e nevoie.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-data-contract">Data contract</Label>
                <Input id="ct-data-contract" type="date" value={contractDateIso} onChange={(e) => setContractDateIso(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-taxa-initiere">Taxă de inițiere</Label>
                <Input id="ct-taxa-initiere" value={contractDetails.taxaInitiere ?? ''} onChange={cd('taxaInitiere')} placeholder="ex: 200 EUR" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-facturare-tip">Ciclu de facturare</Label>
                <Select
                  id="ct-facturare-tip"
                  value={contractDetails.facturareTip ?? ''}
                  onChange={cd('facturareTip')}
                >
                  <option value="">—</option>
                  <option value="LUNAR">Lunar</option>
                  <option value="ANUAL">Anual</option>
                  <option value="SPECIAL">Special</option>
                </Select>
              </div>
              {contractDetails.facturareTip === 'SPECIAL' && (
                <div className="space-y-2">
                  <Label htmlFor="ct-facturare-tip-other">Descrie ciclul special</Label>
                  <Input
                    id="ct-facturare-tip-other"
                    value={facturareTipOther}
                    onChange={(e) => setFacturareTipOther(e.target.value)}
                    placeholder="ex: trimestrial"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="ct-onboarding-zile">Zile onboarding</Label>
                <Input id="ct-onboarding-zile" value={contractDetails.nrZileOnboarding ?? ''} onChange={cd('nrZileOnboarding')} placeholder="ex: 3" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-operatori-gestiune">Operatori gestiune (desktop)</Label>
                <Input id="ct-operatori-gestiune" inputMode="numeric" value={contractDetails.operatoriGestiune ?? ''} onChange={cd('operatoriGestiune')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-operatori-teren">Operatori teren (mobil)</Label>
                <Input id="ct-operatori-teren" inputMode="numeric" value={contractDetails.operatoriTeren ?? ''} onChange={cd('operatoriTeren')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-puncte-lucru">Puncte de lucru</Label>
                <Input id="ct-puncte-lucru" inputMode="numeric" value={contractDetails.puncteLucru ?? ''} onChange={cd('puncteLucru')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-documente">Documente incluse / lună</Label>
                <Input id="ct-documente" inputMode="numeric" value={contractDetails.documenteIncluse ?? ''} onChange={cd('documenteIncluse')} placeholder="150" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-flux">Flux</Label>
                <Select
                  id="ct-flux"
                  value={contractDetails.flux ?? ''}
                  onChange={cd('flux')}
                >
                  <option value="">—</option>
                  <option value="Standard">Standard</option>
                  <option value="DEEE / DBA">DEEE / DBA</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Module add-on active</Label>
              {!platformId ? (
                <p className="text-xs text-muted-foreground">Mapează clientul la o platformă mai sus ca să vezi catalogul de add-on-uri.</p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {moduleAddonOptions.map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={moduleAddonSelected.includes(opt)}
                      onChange={(e) =>
                        setModuleAddonSelected((sel) => (e.target.checked ? [...sel, opt] : sel.filter((o) => o !== opt)))
                      }
                    />
                    {opt}
                  </label>
                ))}
              </div>
              <Input
                value={moduleAddonOther}
                onChange={(e) => setModuleAddonOther(e.target.value)}
                placeholder="Altele (text liber, ex: E-Factura ANAF SPV) — gol + nimic bifat = Niciunul"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={contractDetails.areLunaGratuita ?? true}
                onChange={(e) => setContractDetails((d) => ({ ...d, areLunaGratuita: e.target.checked }))}
              />
              Are Lună Gratuită (durata vine din Setări → Șabloane contracte → Termeni comerciali)
            </label>
            <div className="space-y-2">
              <Label htmlFor="ct-conditii">Condiții speciale negociate</Label>
              <Input id="ct-conditii" value={contractDetails.conditiiSpeciale ?? ''} onChange={cd('conditiiSpeciale')} placeholder="(fără condiții speciale)" />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
