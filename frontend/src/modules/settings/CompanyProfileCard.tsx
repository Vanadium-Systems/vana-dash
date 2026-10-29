import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { getLocale, t } from '@/shared/lib/i18n'

interface CompanyAddress {
  county: string
  city: string
  street: string
  number: string
  details: string
  postalCode: string
}

interface CompanyLocation extends CompanyAddress {
  id: string
  label: string
}

interface CompanyProfile {
  name: string
  cui: string
  vatIntraCode: string
  regCom: string
  caenCode: string
  capitalSocial: string
  iban: string
  bank: string
  phone: string
  email: string
  annualTurnoverRon: string
  vatPayer: boolean
  representative: string
  declarant: { firstName: string; lastName: string; role: string }
  registeredOffice: CompanyAddress
  workLocations: CompanyLocation[]
}

interface CompanySettings {
  profile: CompanyProfile
  country: string
  timeZone: string
  currency: string
  countries: string[]
}

const EMPTY_ADDRESS: CompanyAddress = { county: '', city: '', street: '', number: '', details: '', postalCode: '' }

const EMPTY_PROFILE: CompanyProfile = {
  name: '',
  cui: '',
  vatIntraCode: '',
  regCom: '',
  caenCode: '',
  capitalSocial: '',
  iban: '',
  bank: '',
  phone: '',
  email: '',
  annualTurnoverRon: '',
  vatPayer: false,
  representative: '',
  declarant: { firstName: '', lastName: '', role: '' },
  registeredOffice: EMPTY_ADDRESS,
  workLocations: [],
}

// Every zone the browser knows, so a typo cannot reach the server.
const TIME_ZONES = Intl.supportedValuesOf('timeZone').map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }))

function countryName(code: string): string {
  return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) ?? code
}

function joinAddress(addr: CompanyAddress): string {
  return [addr.county, addr.city, addr.street, addr.number, addr.details, addr.postalCode].filter(Boolean).join(', ')
}

async function copy(value: string) {
  if (!value) return
  await navigator.clipboard.writeText(value)
  toast.success(t('common:states.copied'))
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="w-9 shrink-0"
      disabled={!value}
      aria-label={t('common:actions.copy')}
      onClick={() => void copy(value)}
    >
      <Copy className="h-4 w-4" />
    </Button>
  )
}

function FieldRow({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-1">
        <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <CopyButton value={value} />
      </div>
    </div>
  )
}

function AddressFields({
  idPrefix,
  address,
  onChange,
}: {
  idPrefix: string
  address: CompanyAddress
  onChange: (address: CompanyAddress) => void
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow
          id={`${idPrefix}-county`}
          label={t('common:labels.county')}
          value={address.county}
          placeholder={t('settings:company.countyPlaceholder')}
          onChange={(county) => onChange({ ...address, county })}
        />
        <FieldRow
          id={`${idPrefix}-city`}
          label={t('settings:company.locality')}
          value={address.city}
          placeholder={t('settings:company.localityPlaceholder')}
          onChange={(city) => onChange({ ...address, city })}
        />
        <FieldRow
          id={`${idPrefix}-street`}
          label={t('settings:company.street')}
          value={address.street}
          placeholder={t('settings:company.streetPlaceholder')}
          onChange={(street) => onChange({ ...address, street })}
        />
        <FieldRow
          id={`${idPrefix}-number`}
          label={t('common:labels.number')}
          value={address.number}
          placeholder={t('settings:company.numberPlaceholder')}
          onChange={(number) => onChange({ ...address, number })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <FieldRow
          id={`${idPrefix}-details`}
          label={t('settings:company.addressDetails')}
          value={address.details}
          placeholder={t('settings:company.addressDetailsPlaceholder')}
          onChange={(details) => onChange({ ...address, details })}
        />
        <FieldRow
          id={`${idPrefix}-postal`}
          label={t('settings:company.postalCode')}
          value={address.postalCode}
          onChange={(postalCode) => onChange({ ...address, postalCode })}
        />
      </div>
      <div className="space-y-1">
        <Label>{t('settings:company.fullAddress')}</Label>
        <div className="flex gap-1">
          <Input value={joinAddress(address)} readOnly className="text-muted-foreground" />
          <CopyButton value={joinAddress(address)} />
        </div>
      </div>
    </div>
  )
}

function WorkLocationBlock({
  location,
  onChange,
  onRemove,
}: {
  location: CompanyLocation
  onChange: (location: CompanyLocation) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-end gap-1">
        <div className="flex-1">
          <FieldRow
            id={`loc-${location.id}-label`}
            label={t('settings:company.siteLabel')}
            value={location.label}
            placeholder={t('settings:company.siteLabelPlaceholder')}
            onChange={(label) => onChange({ ...location, label })}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mb-[1px] w-9 shrink-0"
          aria-label={t('settings:company.deleteSite')}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <AddressFields
        idPrefix={`loc-${location.id}`}
        address={location}
        onChange={(address) => onChange({ ...location, ...address })}
      />
    </div>
  )
}

export function CompanyProfileCard() {
  const queryClient = useQueryClient()
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE)
  const [timeZone, setTimeZone] = useState('')
  const [currency, setCurrency] = useState('')

  const query = useQuery({
    queryKey: ['settings', 'company-profile'],
    queryFn: () => api.get<CompanySettings>('/api/settings/company-profile'),
  })

  useEffect(() => {
    if (!query.data) return
    setProfile(query.data.profile)
    setTimeZone(query.data.timeZone)
    setCurrency(query.data.currency)
  }, [query.data])

  const save = useMutation({
    mutationFn: () => api.put<CompanySettings>('/api/settings/company-profile', { profile, timeZone, currency: currency.trim().toUpperCase() }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'company-profile'], data)
      // The time zone travels with /me; the dates on every page follow it.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
      toast.success(t('settings:company.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (query.isPending) return null

  const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) =>
    setProfile((prev) => ({ ...prev, [key]: value }))

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div>
          <CardTitle className="text-base">{t('settings:company.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('settings:company.hint')}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow id="company-name" label={t('settings:company.name')} value={profile.name} onChange={(v) => set('name', v)} />
          <FieldRow id="company-cui" label={t('settings:company.cui')} value={profile.cui} onChange={(v) => set('cui', v)} />
          <FieldRow
            id="company-vat-intra"
            label={t('settings:company.vatCode')}
            value={profile.vatIntraCode}
            onChange={(v) => set('vatIntraCode', v)}
          />
          <FieldRow
            id="company-reg-com"
            label={t('settings:company.tradeRegister')}
            value={profile.regCom}
            onChange={(v) => set('regCom', v)}
          />
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">{t('settings:company.other')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow id="company-caen" label={t('settings:company.caen')} value={profile.caenCode} onChange={(v) => set('caenCode', v)} />
            <FieldRow
              id="company-capital"
              label={t('settings:company.shareCapital')}
              value={profile.capitalSocial}
              onChange={(v) => set('capitalSocial', v)}
            />
            <FieldRow id="company-iban" label="IBAN" value={profile.iban} onChange={(v) => set('iban', v)} />
            <FieldRow id="company-bank" label={t('settings:company.bank')} value={profile.bank} onChange={(v) => set('bank', v)} />
            <FieldRow id="company-phone" label={t('settings:company.phone')} value={profile.phone} onChange={(v) => set('phone', v)} />
            <FieldRow id="company-email" label={t('settings:company.email')} value={profile.email} onChange={(v) => set('email', v)} />
            <div className="space-y-1">
              <Label htmlFor="company-turnover">{t('settings:company.turnover')}</Label>
              <div className="flex gap-1">
                <Input
                  id="company-turnover"
                  value={profile.annualTurnoverRon}
                  placeholder="250000"
                  onChange={(e) => set('annualTurnoverRon', e.target.value)}
                />
                <CopyButton value={profile.annualTurnoverRon} />
              </div>
              <p className="text-xs text-muted-foreground">{t('settings:company.turnoverHint')}</p>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">{t('settings:company.invoicing')}</p>
          <label htmlFor="company-vat-payer" className="flex items-center gap-2 text-sm">
            <Checkbox id="company-vat-payer" checked={profile.vatPayer} onChange={(e) => set('vatPayer', e.target.checked)} />
            {t('settings:company.vatPayer')}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow
              id="company-representative"
              label={t('settings:company.representative')}
              value={profile.representative}
              onChange={(v) => set('representative', v)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('settings:company.declarantHint')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldRow
              id="company-declarant-last"
              label={t('settings:company.declarantLastName')}
              value={profile.declarant.lastName}
              onChange={(lastName) => set('declarant', { ...profile.declarant, lastName })}
            />
            <FieldRow
              id="company-declarant-first"
              label={t('settings:company.declarantFirstName')}
              value={profile.declarant.firstName}
              onChange={(firstName) => set('declarant', { ...profile.declarant, firstName })}
            />
            <FieldRow
              id="company-declarant-role"
              label={t('settings:company.declarantRole')}
              value={profile.declarant.role}
              placeholder={t('settings:company.declarantRolePlaceholder')}
              onChange={(role) => set('declarant', { ...profile.declarant, role })}
            />
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">{t('settings:company.registeredOffice')}</p>
          <AddressFields
            idPrefix="office"
            address={profile.registeredOffice}
            onChange={(registeredOffice) => set('registeredOffice', registeredOffice)}
          />
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">{t('settings:company.workSites')}</p>
          <div className="space-y-3">
            {profile.workLocations.map((location) => (
              <WorkLocationBlock
                key={location.id}
                location={location}
                onChange={(next) =>
                  set(
                    'workLocations',
                    profile.workLocations.map((l) => (l.id === next.id ? next : l)),
                  )
                }
                onRemove={() => set('workLocations', profile.workLocations.filter((l) => l.id !== location.id))}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              set('workLocations', [...profile.workLocations, { id: crypto.randomUUID(), label: '', ...EMPTY_ADDRESS }])
            }
          >
            <Plus className="h-4 w-4" /> {t('settings:company.newWorkSite')}
          </Button>
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">{t('settings:company.region')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="company-country">{t('settings:company.country')}</Label>
              <Input id="company-country" value={query.data ? countryName(query.data.country) : ''} readOnly className="text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-time-zone">{t('settings:company.timeZone')}</Label>
              <Select id="company-time-zone" value={timeZone} options={TIME_ZONES} onValueChange={setTimeZone} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-currency">{t('settings:company.currency')}</Label>
              <Input id="company-currency" value={currency} maxLength={3} className="uppercase" onChange={(e) => setCurrency(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings:company.regionHint')}</p>
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('common:actions.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
