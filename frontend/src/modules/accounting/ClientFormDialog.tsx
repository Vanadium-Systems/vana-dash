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
import { t } from '@/shared/lib/i18n'
import { bundleMonthlyTotal } from '@/modules/pricing/calc'

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
  return owner ? t('accounting:clientForm.alreadyUsed', { label, name: owner.name }) : null
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
    setSubscriptionPriceCurrency('eur')
    setSubscriptionPriceAmount(String(bundleMonthlyTotal(pricingConfig.data!.config, bundle)))
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
  const selectedTenant = vanagreenTenants.data?.find((tenant) => tenant.id === vanagreenTenantId)

  // Căutare client-side, capată la 8 rezultate — cu 100+ clienți vanagreen, o listă plată
  // nefiltrată devine imposibil de răsfoit manual (semnalat de Stefan). Tastarea îngustează.
  const filteredTenants = sortedTenants
    .filter((tenant) => {
      const q = tenantSearch.trim().toLowerCase()
      if (!q) return true
      return tenant.name.toLowerCase().includes(q) || (tenant.cif ?? '').toLowerCase().includes(q)
    })
    .slice(0, 8)

  const verifyTenant = useMutation({
    mutationFn: () =>
      api.post<{ exists: boolean }>('/api/reconciliation/vanagreen-tenants/verify', { tenantId: vanagreenTenantId }),
    onSuccess: ({ exists }) => {
      if (exists) toast.success(t('accounting:clientForm.tenantFound'))
      else toast.error(t('accounting:clientForm.tenantNotFound'))
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
      if (info.stare !== 'activ') toast.warning(t('accounting:clientForm.anafFoundWithState', { stare: info.stare }))
      else toast.success(t('accounting:clientForm.anafFilled'))
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
      toast.success(client ? t('accounting:clientForm.updated') : t('accounting:clientForm.added'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const nrContractConflict = contractNumberConflict(contractDetails.nrContract, clients.data, reservedNumbers.data ?? [], client?.id ?? null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? t('accounting:clientForm.editTitle') : t('accounting:clients.add')}</DialogTitle>
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
              <p className="font-medium">{t('accounting:clientForm.autoCreatedHint')}</p>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={needsBillingInfo} onChange={(e) => setNeedsBillingInfo(e.target.checked)} />
                {t('accounting:clientForm.keepIncomplete')}
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-name">{t('accounting:clientForm.name')}</Label>
              <Input id="c-name" value={form.name} onChange={set('name')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-slug">{t('accounting:clientForm.slug')}</Label>
              <Input id="c-slug" value={form.slug} onChange={set('slug')} placeholder={t('accounting:clientForm.slugPlaceholder')} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-cif">{t('common:labels.cif')}</Label>
              <div className="flex gap-2">
                <Input id="c-cif" value={form.cif} onChange={set('cif')} required />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!form.cif || anafLookup.isPending}
                  onClick={() => anafLookup.mutate()}
                >
                  {anafLookup.isPending ? t('accounting:clientForm.anafSearching') : t('accounting:clientForm.anafSearch')}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-regcom">{t('accounting:clientForm.regCom')}</Label>
              <Input id="c-regcom" value={form.regCom} onChange={set('regCom')} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-address">{t('common:labels.address')}</Label>
            <Input id="c-address" value={form.address} onChange={set('address')} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="c-city">{t('common:labels.city')}</Label>
              <Input id="c-city" value={form.city} onChange={set('city')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-county">{t('common:labels.county')}</Label>
              <Input id="c-county" value={form.county} onChange={set('county')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-email">{t('common:labels.email')}</Label>
              <Input id="c-email" type="email" value={form.email} onChange={set('email')} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-iban">{t('accounting:clientForm.iban')}</Label>
              <Input id="c-iban" value={form.iban} onChange={set('iban')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-bank">{t('accounting:clientForm.bank')}</Label>
              <Input id="c-bank" value={form.bank} onChange={set('bank')} />
            </div>
          </div>
          <div className="space-y-2 border-tenant pt-4">
            <Label htmlFor="c-platform">{t('accounting:clientForm.integratedApp')}</Label>
            <Select
              id="c-platform"
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
            >
              <option value="">{t('accounting:clientForm.noPlatform')}</option>
              {(platforms.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('accounting:clientForm.platformHint')}
            </p>
          </div>

          <div className="space-y-3 border-tenant pt-4">
            <Label className="text-sm font-semibold">{t('accounting:clientForm.vanagreen')}</Label>
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
                {t('accounting:clientForm.createInVanagreen')}
              </label>
            )}
            <div className="space-y-2">
              <Label htmlFor="c-vanagreen-search">{t('accounting:clientForm.tenantSuggestion')}</Label>
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
                    {t('accounting:clientForm.change')}
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
                    placeholder={t('accounting:clientForm.searchByNameOrCif')}
                    disabled={createInVanagreen}
                  />
                  {tenantDropdownOpen && !createInVanagreen && (
                    <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-input bg-popover shadow-md">
                      {filteredTenants.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">{t('accounting:clientForm.noResult')}</div>
                      ) : (
                        filteredTenants.map((tenant) => (
                          <button
                            key={tenant.id}
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                            // onMouseDown (nu onClick) — se declanșează ÎNAINTE de onBlur-ul
                            // input-ului, altfel dropdown-ul se închide înainte să înregistrăm click-ul.
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setVanagreenTenantId(tenant.id)
                              setTenantSearch('')
                              setTenantDropdownOpen(false)
                            }}
                          >
                            {tenant.name} {tenant.cif ? `(${tenant.cif})` : ''}
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
                <Label htmlFor="c-vanagreen-id">{t('accounting:clientForm.tenantId')}</Label>
                <Input
                  id="c-vanagreen-id"
                  value={vanagreenTenantId}
                  onChange={(e) => setVanagreenTenantId(e.target.value)}
                  placeholder={t('accounting:clientForm.tenantIdPlaceholder')}
                  disabled={createInVanagreen}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!vanagreenTenantId || createInVanagreen || verifyTenant.isPending}
                onClick={() => verifyTenant.mutate()}
              >
                {t('accounting:clientForm.verify')}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-extend-months">{t('accounting:clientForm.monthsToExtend')}</Label>
              <Input
                id="c-extend-months"
                inputMode="numeric"
                value={vanagreenExtendMonths}
                onChange={(e) => setVanagreenExtendMonths(e.target.value)}
                placeholder={t('accounting:clientForm.monthsPlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-3 border-tenant pt-4">
            <Label className="text-sm font-semibold">{t('accounting:clientForm.billingCadence')}</Label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="c-cycle-type">{t('common:labels.type')}</Label>
                <Select
                  id="c-cycle-type"
                  value={billingCycle}
                  onChange={(e) => setBillingCycle(e.target.value as '' | 'monthly' | 'annual')}
                >
                  <option value="">{t('accounting:clientForm.cadenceNone')}</option>
                  <option value="monthly">{t('common:labels.monthly')}</option>
                  <option value="annual">{t('common:labels.yearly')}</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-cycle-day">{t('accounting:clientForm.dayOfMonth')}</Label>
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
                  <Label htmlFor="c-cycle-month">{t('common:labels.month')}</Label>
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
              <Label htmlFor="c-due-date">{t('accounting:clientForm.currentDueDate')}</Label>
              <Input id="c-due-date" type="date" value={billingDueDate} onChange={(e) => setBillingDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-payment-terms">{t('accounting:clientForm.paymentTerm')}</Label>
              <Input
                id="c-payment-terms"
                inputMode="numeric"
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                placeholder={t('accounting:clientForm.paymentTermPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('accounting:clientForm.paymentTermHint')}
              </p>
            </div>
          </div>

          <div className="space-y-3 border-tenant pt-4">
            <Label className="text-sm font-semibold">{t('accounting:clientForm.autoBilling')}</Label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-price-currency">{t('accounting:clientForm.subscriptionCurrency')}</Label>
                <Select
                  id="c-price-currency"
                  value={subscriptionPriceCurrency}
                  onChange={(e) => setSubscriptionPriceCurrency(e.target.value as 'lei' | 'eur')}
                >
                  <option value="lei">{t('accounting:clientForm.currencyRon')}</option>
                  <option value="eur">EUR</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-price-amount">{t('accounting:clientForm.subscriptionPrice')}</Label>
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
              {t('accounting:clientForm.autoIssue')}
            </label>
          </div>

          <div className="space-y-3 border-tenant pt-4">
            <Label className="text-sm font-semibold">{t('accounting:clientForm.contractData')}</Label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ct-contact-name">{t('accounting:contract.fields.representative')}</Label>
                <Input id="ct-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={t('accounting:clientForm.representativePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-contact-title">{t('accounting:contract.fields.representativeRole')}</Label>
                <Input id="ct-contact-title" value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} placeholder={t('accounting:clientForm.representativeRolePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-phone">{t('accounting:contract.fields.clientPhone')}</Label>
                <Input id="ct-phone" value={contractPhone} onChange={(e) => setContractPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-plan">{t('common:nav.plan')}</Label>
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
                  <option value="Privat">{t('accounting:clientForm.planPrivate')}</option>
                  {contractPlan && contractPlan !== 'Privat' && !bundles.some((b) => b.label === contractPlan) && (
                    <option value={contractPlan}>{t('accounting:clientForm.planOld', { contractPlan })}</option>
                  )}
                </Select>
                {bundles.some((b) => b.label === contractPlan) && (
                  <p className="text-xs text-muted-foreground">{t('accounting:clientForm.planHint')}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-nr-contract">{t('accounting:contract.fields.contractNumber')}</Label>
                <Input
                  id="ct-nr-contract"
                  value={contractDetails.nrContract ?? ''}
                  onChange={cd('nrContract')}
                  placeholder={t('accounting:clientForm.contractNumberPlaceholder')}
                  aria-describedby="ct-nr-contract-hint"
                />
                {nrContractConflict ? (
                  <p id="ct-nr-contract-hint" className="text-xs text-warning">{nrContractConflict}</p>
                ) : (
                  <p id="ct-nr-contract-hint" className="text-xs text-muted-foreground">{t('accounting:clientForm.contractNumberHint')}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-data-contract">{t('accounting:contract.fields.contractDate')}</Label>
                <Input id="ct-data-contract" type="date" value={contractDateIso} onChange={(e) => setContractDateIso(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-taxa-initiere">{t('accounting:contract.fields.setupFee')}</Label>
                <Input id="ct-taxa-initiere" value={contractDetails.taxaInitiere ?? ''} onChange={cd('taxaInitiere')} placeholder={t('accounting:clientForm.setupFeePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-facturare-tip">{t('accounting:contract.fields.billingCycle')}</Label>
                <Select
                  id="ct-facturare-tip"
                  value={contractDetails.facturareTip ?? ''}
                  onChange={cd('facturareTip')}
                >
                  <option value="">—</option>
                  <option value="LUNAR">{t('common:labels.monthly')}</option>
                  <option value="ANUAL">{t('common:labels.yearly')}</option>
                  <option value="SPECIAL">{t('accounting:clientForm.cycleSpecial')}</option>
                </Select>
              </div>
              {contractDetails.facturareTip === 'SPECIAL' && (
                <div className="space-y-2">
                  <Label htmlFor="ct-facturare-tip-other">{t('accounting:clientForm.describeSpecialCycle')}</Label>
                  <Input
                    id="ct-facturare-tip-other"
                    value={facturareTipOther}
                    onChange={(e) => setFacturareTipOther(e.target.value)}
                    placeholder={t('accounting:clientForm.specialCyclePlaceholder')}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="ct-onboarding-zile">{t('accounting:clientForm.onboardingDays')}</Label>
                <Input id="ct-onboarding-zile" value={contractDetails.nrZileOnboarding ?? ''} onChange={cd('nrZileOnboarding')} placeholder={t('accounting:clientForm.onboardingDaysPlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-operatori-gestiune">{t('accounting:clientForm.desktopOperators')}</Label>
                <Input id="ct-operatori-gestiune" inputMode="numeric" value={contractDetails.operatoriGestiune ?? ''} onChange={cd('operatoriGestiune')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-operatori-teren">{t('accounting:clientForm.mobileOperators')}</Label>
                <Input id="ct-operatori-teren" inputMode="numeric" value={contractDetails.operatoriTeren ?? ''} onChange={cd('operatoriTeren')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-puncte-lucru">{t('accounting:clientForm.workSites')}</Label>
                <Input id="ct-puncte-lucru" inputMode="numeric" value={contractDetails.puncteLucru ?? ''} onChange={cd('puncteLucru')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-documente">{t('accounting:clientForm.documentsPerMonth')}</Label>
                <Input id="ct-documente" inputMode="numeric" value={contractDetails.documenteIncluse ?? ''} onChange={cd('documenteIncluse')} placeholder="150" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-flux">{t('accounting:clientForm.flow')}</Label>
                <Select
                  id="ct-flux"
                  value={contractDetails.flux ?? ''}
                  onChange={cd('flux')}
                >
                  <option value="">—</option>
                  <option value="Standard">{t('accounting:clientForm.flowStandard')}</option>
                  <option value="DEEE / DBA">DEEE / DBA</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">{t('accounting:clientForm.activeAddons')}</Label>
              {!platformId ? (
                <p className="text-xs text-muted-foreground">{t('accounting:clientForm.mapPlatformForAddons')}</p>
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
                placeholder={t('accounting:clientForm.otherAddonsPlaceholder')}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={contractDetails.areLunaGratuita ?? true}
                onChange={(e) => setContractDetails((d) => ({ ...d, areLunaGratuita: e.target.checked }))}
              />
              {t('accounting:clientForm.hasFreeMonth')}
            </label>
            <div className="space-y-2">
              <Label htmlFor="ct-conditii">{t('accounting:clientForm.specialTerms')}</Label>
              <Input id="ct-conditii" value={contractDetails.conditiiSpeciale ?? ''} onChange={cd('conditiiSpeciale')} placeholder={t('accounting:clientForm.noSpecialTerms')} />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
