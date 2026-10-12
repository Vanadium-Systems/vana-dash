import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'

interface CompanyAddress {
  county: string
  city: string
  street: string
  number: string
  details: string
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
  registeredOffice: CompanyAddress
  workLocations: CompanyLocation[]
}

const EMPTY_ADDRESS: CompanyAddress = { county: '', city: '', street: '', number: '', details: '' }

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
  registeredOffice: EMPTY_ADDRESS,
  workLocations: [],
}

function joinAddress(addr: CompanyAddress): string {
  return [addr.county, addr.city, addr.street, addr.number, addr.details].filter(Boolean).join(', ')
}

async function copy(value: string) {
  if (!value) return
  await navigator.clipboard.writeText(value)
  toast.success('Copiat')
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="w-9 shrink-0"
      disabled={!value}
      aria-label="Copiază"
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
          label="Județ"
          value={address.county}
          placeholder="Județ Cluj"
          onChange={(county) => onChange({ ...address, county })}
        />
        <FieldRow
          id={`${idPrefix}-city`}
          label="Localitate"
          value={address.city}
          placeholder="Municipiul Cluj-Napoca"
          onChange={(city) => onChange({ ...address, city })}
        />
        <FieldRow
          id={`${idPrefix}-street`}
          label="Stradă"
          value={address.street}
          placeholder="Str. Exemplu"
          onChange={(street) => onChange({ ...address, street })}
        />
        <FieldRow
          id={`${idPrefix}-number`}
          label="Nr."
          value={address.number}
          placeholder="Nr. 10"
          onChange={(number) => onChange({ ...address, number })}
        />
      </div>
      <FieldRow
        id={`${idPrefix}-details`}
        label="Detalii (bloc, scară, etaj, apartament, birou)"
        value={address.details}
        placeholder="Bloc A, Scara 1, Etaj 2, Ap. 4"
        onChange={(details) => onChange({ ...address, details })}
      />
      <div className="space-y-1">
        <Label>Adresă completă</Label>
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
            label="Etichetă (opțional)"
            value={location.label}
            placeholder="Depozit Cluj"
            onChange={(label) => onChange({ ...location, label })}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mb-[1px] w-9 shrink-0"
          aria-label="Șterge punctul de lucru"
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

  const query = useQuery({
    queryKey: ['settings', 'company-profile'],
    queryFn: () => api.get<{ profile: CompanyProfile | null }>('/api/settings/company-profile'),
  })

  useEffect(() => {
    if (query.data?.profile) setProfile(query.data.profile)
  }, [query.data])

  const save = useMutation({
    mutationFn: (next: CompanyProfile) => api.put<{ profile: CompanyProfile }>('/api/settings/company-profile', next),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'company-profile'], data)
      toast.success('Date firmă salvate')
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
          <CardTitle className="text-base">Date firmă</CardTitle>
          <p className="text-sm text-muted-foreground">
            Fișă de referință — copiază rapid ce completezi mereu prin formulare, contracte sau înregistrări.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow id="company-name" label="Nume firmă" value={profile.name} onChange={(v) => set('name', v)} />
          <FieldRow id="company-cui" label="CUI" value={profile.cui} onChange={(v) => set('cui', v)} />
          <FieldRow
            id="company-vat-intra"
            label="Cod TVA intracomunitar"
            value={profile.vatIntraCode}
            onChange={(v) => set('vatIntraCode', v)}
          />
          <FieldRow
            id="company-reg-com"
            label="Înregistrare Registrul Comerțului"
            value={profile.regCom}
            onChange={(v) => set('regCom', v)}
          />
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Alte date</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow id="company-caen" label="Cod CAEN principal" value={profile.caenCode} onChange={(v) => set('caenCode', v)} />
            <FieldRow
              id="company-capital"
              label="Capital social"
              value={profile.capitalSocial}
              onChange={(v) => set('capitalSocial', v)}
            />
            <FieldRow id="company-iban" label="IBAN" value={profile.iban} onChange={(v) => set('iban', v)} />
            <FieldRow id="company-bank" label="Bancă" value={profile.bank} onChange={(v) => set('bank', v)} />
            <FieldRow id="company-phone" label="Telefon firmă" value={profile.phone} onChange={(v) => set('phone', v)} />
            <FieldRow id="company-email" label="Email firmă" value={profile.email} onChange={(v) => set('email', v)} />
            <div className="space-y-1">
              <Label htmlFor="company-turnover">Cifră de afaceri anuală (lei)</Label>
              <div className="flex gap-1">
                <Input
                  id="company-turnover"
                  value={profile.annualTurnoverRon}
                  placeholder="250000"
                  onChange={(e) => set('annualTurnoverRon', e.target.value)}
                />
                <CopyButton value={profile.annualTurnoverRon} />
              </div>
              <p className="text-xs text-muted-foreground">Pragul folosit la filtrarea de eligibilitate în Licitații (Secțiunea 3 SICAP).</p>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Sediu social</p>
          <AddressFields
            idPrefix="office"
            address={profile.registeredOffice}
            onChange={(registeredOffice) => set('registeredOffice', registeredOffice)}
          />
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Puncte de lucru</p>
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
            <Plus className="h-4 w-4" /> Punct de lucru nou
          </Button>
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button disabled={save.isPending} onClick={() => save.mutate(profile)}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvează
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
