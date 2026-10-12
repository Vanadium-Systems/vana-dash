import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import { downloadCsv } from '@/shared/lib/csv'
import type { Platform, PricingConfig, PricingConfigRow } from '@/shared/lib/types'
import { PlatformTemplatesSection } from './PlatformTemplatesSection'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'

// Sprint D, Track 4 — calculator de preț modular per platformă. Portat din
// vanagreen-price-calculator.html (research Stefan): config editabil din UI (NU redeploy
// de cod la orice schimbare de preț), legat de platformId (nu hardcodat pe "vanagreen").

interface DocBandDraft {
  upTo: string // gol = ∞ (ultima bandă)
  rate: string // gol = peste prag, manual review
}
interface PuncteBandDraft {
  max: string // gol = ∞ (ultima bandă)
  mult: string
  label: string
  planName: string // gol = fără plan asociat, /calculate întoarce planName: null
}
interface EquipmentDraft {
  id: string
  name: string
  purchasePrice: string
  integrationPrice: string
  monthlyFee: string
}
interface AddonDraft {
  key: string
  label: string
  price: string
  // benzi pe cantitate (2026-08-25): undefined = preț fix; array = trepte {upTo, unitPrice}
  bands?: Array<{ upTo: string; unitPrice: string }>
}
interface BundleDraft {
  key: string
  label: string
  addonKeys: string[]
  price: string
  puncteLucru: string // gol = fără preset
  operatoriDesktop: string
  operatoriMobil: string
  documente: string
  cantare: string
  onboardingPrice: string
}

interface ConfigForm {
  basePrice: string
  operatorDesktopRate: string
  operatorMobilRate: string
  documenteIncluse: string
  fluxDeeeDelta: string
  addons: AddonDraft[]
  bundles: BundleDraft[]
  cantarRate: string
  cantarSetupPrice: string
  siatdFloorPrice: string
  siatdFloorUnits: string
  siatdUnitPrice: string
  lunileAnuale: string
  onboardingBase: string
  onboardingOpRate: string
  onboardingDeeeDelta: string
  onboardingSiatdSetup: string
  documentBands: DocBandDraft[]
  puncteBands: PuncteBandDraft[]
  equipmentItems: EquipmentDraft[]
}

// Deliberat GOL — nu presupunem valorile din HTML-ul vechi ca default hardcodat în cod
// (ar reintroduce exact hardcodarea pe care Stefan vrea s-o elimine). Stefan le introduce
// manual, din UI, la prima folosire pt. o platformă nouă.
function emptyConfigForm(): ConfigForm {
  return {
    basePrice: '',
    operatorDesktopRate: '',
    operatorMobilRate: '',
    documenteIncluse: '',
    fluxDeeeDelta: '',
    addons: [],
    bundles: [],
    cantarRate: '',
    cantarSetupPrice: '',
    siatdFloorPrice: '',
    siatdFloorUnits: '',
    siatdUnitPrice: '',
    lunileAnuale: '',
    onboardingBase: '',
    onboardingOpRate: '',
    onboardingDeeeDelta: '',
    onboardingSiatdSetup: '',
    documentBands: [{ upTo: '', rate: '' }],
    puncteBands: [{ max: '', mult: '', label: '', planName: '' }],
    equipmentItems: [],
  }
}

function configToForm(c: PricingConfig): ConfigForm {
  return {
    basePrice: String(c.basePrice),
    operatorDesktopRate: String(c.operatorDesktopRate),
    operatorMobilRate: String(c.operatorMobilRate),
    documenteIncluse: String(c.documenteIncluse),
    fluxDeeeDelta: String(c.fluxDeeeDelta),
    addons: c.addons.map((a) => ({
      key: a.key,
      label: a.label,
      price: String(a.price),
      ...(a.bands?.length ? { bands: a.bands.map((b) => ({ upTo: b.upTo === null ? '' : String(b.upTo), unitPrice: String(b.unitPrice) })) } : {}),
    })),
    bundles: c.bundles.map((b) => ({
      key: b.key,
      label: b.label,
      addonKeys: b.addonKeys,
      price: String(b.price),
      puncteLucru: b.puncteLucru === undefined ? '' : String(b.puncteLucru),
      operatoriDesktop: b.operatoriDesktop === undefined ? '' : String(b.operatoriDesktop),
      operatoriMobil: b.operatoriMobil === undefined ? '' : String(b.operatoriMobil),
      documente: b.documente === undefined ? '' : String(b.documente),
      cantare: b.cantare === undefined ? '' : String(b.cantare),
      onboardingPrice: String(b.onboardingPrice),
    })),
    cantarRate: String(c.cantarRate),
    cantarSetupPrice: String(c.cantarSetupPrice),
    siatdFloorPrice: String(c.siatdFloorPrice),
    siatdFloorUnits: String(c.siatdFloorUnits),
    siatdUnitPrice: String(c.siatdUnitPrice),
    lunileAnuale: String(c.lunileAnuale),
    onboardingBase: String(c.onboardingBase),
    onboardingOpRate: String(c.onboardingOpRate),
    onboardingDeeeDelta: String(c.onboardingDeeeDelta),
    onboardingSiatdSetup: String(c.onboardingSiatdSetup),
    documentBands: c.documentBands.map((b) => ({ upTo: b.upTo === null ? '' : String(b.upTo), rate: b.rate === null ? '' : String(b.rate) })),
    puncteBands: c.puncteBands.map((b) => ({ max: b.max === null ? '' : String(b.max), mult: String(b.mult), label: b.label, planName: b.planName ?? '' })),
    equipmentItems: c.equipmentItems.map((e) => ({
      id: e.id,
      name: e.name,
      purchasePrice: String(e.purchasePrice),
      integrationPrice: String(e.integrationPrice),
      monthlyFee: String(e.monthlyFee),
    })),
  }
}

function formToConfig(f: ConfigForm): PricingConfig {
  return {
    basePrice: parseRoDecimal(f.basePrice) || 0,
    operatorDesktopRate: parseRoDecimal(f.operatorDesktopRate) || 0,
    operatorMobilRate: parseRoDecimal(f.operatorMobilRate) || 0,
    documenteIncluse: parseRoDecimal(f.documenteIncluse) || 0,
    fluxDeeeDelta: parseRoDecimal(f.fluxDeeeDelta) || 0,
    addons: f.addons.map((a) => ({
      key: a.key,
      label: a.label,
      price: parseRoDecimal(a.price) || 0,
      ...(a.bands?.length
        ? {
            bands: a.bands.map((b) => ({ upTo: b.upTo === '' ? null : parseRoDecimal(b.upTo), unitPrice: parseRoDecimal(b.unitPrice) || 0 })),
          }
        : {}),
    })),
    bundles: f.bundles.map((b) => ({
      key: b.key,
      label: b.label,
      addonKeys: b.addonKeys,
      price: parseRoDecimal(b.price) || 0,
      puncteLucru: b.puncteLucru === '' ? undefined : parseRoDecimal(b.puncteLucru) || 0,
      operatoriDesktop: b.operatoriDesktop === '' ? undefined : parseRoDecimal(b.operatoriDesktop) || 0,
      operatoriMobil: b.operatoriMobil === '' ? undefined : parseRoDecimal(b.operatoriMobil) || 0,
      documente: b.documente === '' ? undefined : parseRoDecimal(b.documente) || 0,
      cantare: b.cantare === '' ? undefined : parseRoDecimal(b.cantare) || 0,
      onboardingPrice: parseRoDecimal(b.onboardingPrice) || 0,
    })),
    cantarRate: parseRoDecimal(f.cantarRate) || 0,
    cantarSetupPrice: parseRoDecimal(f.cantarSetupPrice) || 0,
    siatdFloorPrice: parseRoDecimal(f.siatdFloorPrice) || 0,
    siatdFloorUnits: parseRoDecimal(f.siatdFloorUnits) || 0,
    siatdUnitPrice: parseRoDecimal(f.siatdUnitPrice) || 0,
    lunileAnuale: parseRoDecimal(f.lunileAnuale) || 0,
    onboardingBase: parseRoDecimal(f.onboardingBase) || 0,
    onboardingOpRate: parseRoDecimal(f.onboardingOpRate) || 0,
    onboardingDeeeDelta: parseRoDecimal(f.onboardingDeeeDelta) || 0,
    onboardingSiatdSetup: parseRoDecimal(f.onboardingSiatdSetup) || 0,
    documentBands: f.documentBands.map((b) => ({ upTo: b.upTo === '' ? null : parseRoDecimal(b.upTo), rate: b.rate === '' ? null : parseRoDecimal(b.rate) })),
    puncteBands: f.puncteBands.map((b) => ({
      max: b.max === '' ? null : parseRoDecimal(b.max),
      mult: parseRoDecimal(b.mult) || 0,
      label: b.label,
      planName: b.planName === '' ? undefined : b.planName,
    })),
    equipmentItems: f.equipmentItems.map((e) => ({
      id: e.id,
      name: e.name,
      purchasePrice: parseRoDecimal(e.purchasePrice) || 0,
      integrationPrice: parseRoDecimal(e.integrationPrice) || 0,
      monthlyFee: parseRoDecimal(e.monthlyFee) || 0,
    })),
  }
}

const NUMERIC_FIELDS: Array<[keyof ConfigForm, string]> = [
  ['basePrice', 'Preț de bază (EUR/lună)'],
  ['operatorDesktopRate', 'Rată operator desktop extra'],
  ['operatorMobilRate', 'Rată operator mobil'],
  ['documenteIncluse', 'Documente incluse în bază'],
  ['fluxDeeeDelta', 'Delta flux DEEE/DBA'],
  ['cantarRate', 'Cântar smart — preț per cântar conectat (EUR/lună)'],
  ['cantarSetupPrice', 'Cântar smart — configurare (EUR, one-time)'],
  ['siatdFloorPrice', 'SIATD — preț prag minim'],
  ['siatdFloorUnits', 'SIATD — unități incluse în prag'],
  ['siatdUnitPrice', 'SIATD — preț per unitate peste prag'],
  ['lunileAnuale', 'Luni plătite la facturare anuală'],
  ['onboardingBase', 'Onboarding — bază'],
  ['onboardingOpRate', 'Onboarding — operator extra'],
  ['onboardingDeeeDelta', 'Onboarding — delta DEEE/DBA'],
  ['onboardingSiatdSetup', 'Onboarding — setup SIATD'],
]

function exportConfigCsv(config: PricingConfig, platformName: string) {
  downloadCsv(`config-pret-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Platformă', platformName],
    [],
    ['Parametru', 'Valoare'],
    ...NUMERIC_FIELDS.map(([key, label]) => [label, String(config[key as keyof PricingConfig])]),
    [],
    ['Add-on-uri'],
    ['Key', 'Etichetă', 'Preț (EUR/lună)'],
    ...config.addons.map((a) => [a.key, a.label, String(a.price)]),
    [],
    ['Pachete'],
    [
      'Key',
      'Etichetă',
      'Preț (EUR/lună)',
      'Configurare (EUR, one-time)',
      'Puncte de lucru',
      'Operatori desktop',
      'Operatori mobil',
      'Documente/lună',
      'Cântare smart',
      'Add-on-uri incluse',
    ],
    ...config.bundles.map((b) => [
      b.key,
      b.label,
      String(b.price),
      String(b.onboardingPrice),
      b.puncteLucru !== undefined ? String(b.puncteLucru) : '',
      b.operatoriDesktop !== undefined ? String(b.operatoriDesktop) : '',
      b.operatoriMobil !== undefined ? String(b.operatoriMobil) : '',
      b.documente !== undefined ? String(b.documente) : '',
      b.cantare !== undefined ? String(b.cantare) : '',
      b.addonKeys.join('; '),
    ]),
    [],
    ['Benzi documente'],
    ['Până la', 'Rată'],
    ...config.documentBands.map((band) => [band.upTo === null ? '∞' : String(band.upTo), band.rate === null ? 'manual' : String(band.rate)]),
    [],
    ['Benzi puncte de lucru'],
    ['Până la', 'Multiplier', 'Etichetă', 'Plan'],
    ...config.puncteBands.map((band) => [band.max === null ? '∞' : String(band.max), String(band.mult), band.label, band.planName ?? '']),
    [],
    ['Echipamente'],
    ['Nume', 'Achiziție (EUR)', 'Integrare (EUR)', 'Abonament lunar (EUR)'],
    ...config.equipmentItems.map((e) => [e.name, String(e.purchasePrice), String(e.integrationPrice), String(e.monthlyFee)]),
  ])
}

interface ConfigPretTabProps {
  platformId: string
  setPlatformId: (id: string) => void
  platforms: Platform[]
}

export function ConfigPretTab({ platformId, setPlatformId, platforms }: ConfigPretTabProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ConfigForm>(emptyConfigForm())

  const config = useQuery({
    queryKey: ['pricing', 'config', platformId],
    queryFn: () => api.get<PricingConfigRow | null>(`/api/pricing/config?platformId=${platformId}`),
    enabled: Boolean(platformId),
  })

  useEffect(() => {
    setForm(config.data?.config ? configToForm(config.data.config) : emptyConfigForm())
  }, [config.data])

  const saveConfig = useMutation({
    mutationFn: () => api.put<PricingConfigRow>('/api/pricing/config', { platformId, config: formToConfig(form) }),
    onSuccess: () => {
      // NetworkFirst pe GET /api/pricing/config (vite.config.ts) — refetch-ul după invalidare
      // ajunge acum la rețea, nu la cache; setQueryData ad-hoc nu mai e necesar (Contractul D).
      void queryClient.invalidateQueries({ queryKey: ['pricing', 'config', platformId] })
      toast.success('Config de preț salvat')
    },
    onError: (err) => toast.error(err.message),
  })

  const setField = (key: keyof ConfigForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className="space-y-6">
      <SelfServePricingToggleCard />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-56 space-y-1">
          <Label htmlFor="p-platform" className="text-xs text-muted-foreground">
            Platformă
          </Label>
          <Select
            id="p-platform"
            value={platformId}
            onChange={(e) => setPlatformId(e.target.value)}
          >
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!platformId ? (
        <p className="text-sm text-muted-foreground">Nicio platformă conectată încă — adaugă una din pagina Platforms.</p>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Config ({config.data?.config ? 'salvat' : 'nesalvat încă — completează și salvează'})</CardTitle>
              {config.data?.config && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => exportConfigCsv(config.data!.config, platforms.find((p) => p.id === platformId)?.name ?? platformId)}
                >
                  <Download className="h-4 w-4" /> Exportă CSV
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {NUMERIC_FIELDS.map(([key, label]) => (
                  // Etichetele variază 1-2 rânduri (ex: "Cântar smart — configurare (EUR, one-time)")
                  // — grid-ul stretch-uiește celula la înălțimea rândului, dar block flow pornește
                  // conținutul din vârf, deci un input dintr-o celulă cu etichetă scurtă rămânea mai
                  // sus decât unul cu etichetă lungă. flex+justify-end lipește toate input-urile de
                  // baza celulei, aliniate identic pe rând, indiferent câte rânduri are eticheta.
                  <div key={key} className="flex flex-col justify-end gap-1">
                    <Label htmlFor={`p-${key}`} className="text-xs">
                      {label}
                    </Label>
                    <Input id={`p-${key}`} inputMode="decimal" value={form[key] as string} onChange={setField(key)} />
                  </div>
                ))}
              </div>

              <BandEditor
                title="Add-on-uri (preț fix/lună, bifabile la calculator)"
                rows={form.addons}
                onChange={(rows) => setForm((f) => ({ ...f, addons: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="space-y-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-40 space-y-1">
                        <Label htmlFor={`addon-key-${i}`} className="text-xs">
                          Key (folosit de calculator/self-serve)
                        </Label>
                        <Input
                          id={`addon-key-${i}`}
                          placeholder="ex: hr"
                          value={row.key}
                          onChange={(e) => update({ ...row, key: e.target.value })}
                        />
                      </div>
                      <div className="w-48 space-y-1">
                        <Label htmlFor={`addon-label-${i}`} className="text-xs">
                          Etichetă
                        </Label>
                        <Input
                          id={`addon-label-${i}`}
                          placeholder="ex: Modul HR"
                          value={row.label}
                          onChange={(e) => update({ ...row, label: e.target.value })}
                        />
                      </div>
                      {row.bands === undefined ? (
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`addon-price-${i}`} className="text-xs">
                            Preț (EUR/lună)
                          </Label>
                          <Input
                            id={`addon-price-${i}`}
                            inputMode="decimal"
                            value={row.price}
                            onChange={(e) => update({ ...row, price: e.target.value })}
                          />
                        </div>
                      ) : null}
                      <Button type="button" variant="outline" onClick={remove}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {row.bands !== undefined ? (
                      <div className="space-y-1 rounded-md border bg-muted/40 p-2">
                        <p className="text-xs text-muted-foreground">
                          Benzi pe cantitate — ultima treaptă cu „upTo" gol = infinit
                        </p>
                        {row.bands.map((band, bi) => (
                          <div key={bi} className="flex items-end gap-2">
                            <div className="w-28 space-y-1">
                              <Label htmlFor={`addon-band-up-${i}-${bi}`} className="text-xs text-muted-foreground">
                                Până la (incl.)
                              </Label>
                              <Input
                                id={`addon-band-up-${i}-${bi}`}
                                inputMode="numeric"
                                value={band.upTo}
                                onChange={(e) =>
                                  update({
                                    ...row,
                                    bands: row.bands!.map((b, j) => (j === bi ? { ...b, upTo: e.target.value } : b)),
                                  })
                                }
                              />
                            </div>
                            <div className="w-32 space-y-1">
                              <Label htmlFor={`addon-band-price-${i}-${bi}`} className="text-xs text-muted-foreground">
                                Preț / unitate
                              </Label>
                              <Input
                                id={`addon-band-price-${i}-${bi}`}
                                inputMode="decimal"
                                value={band.unitPrice}
                                onChange={(e) =>
                                  update({
                                    ...row,
                                    bands: row.bands!.map((b, j) => (j === bi ? { ...b, unitPrice: e.target.value } : b)),
                                  })
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Șterge banda"
                              onClick={() => update({ ...row, bands: row.bands!.filter((_, j) => j !== bi) })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => update({ ...row, bands: [...row.bands!, { upTo: '', unitPrice: '' }] })}
                          >
                            Adaugă treaptă
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => update({ ...row, bands: undefined })}>
                            Renunță la benzi
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="ghost" onClick={() => update({ ...row, bands: [{ upTo: '', unitPrice: '' }] })}>
                        Preț pe benzi de cantitate
                      </Button>
                    )}
                  </div>
                )}
                onAdd={() => setForm((f) => ({ ...f, addons: [...f.addons, { key: '', label: '', price: '' }] }))}
                addLabel="Adaugă add-on"
              />

              <BandEditor
                title="Pachete (bundle-uri de add-on-uri la preț fix)"
                rows={form.bundles}
                onChange={(rows) => setForm((f) => ({ ...f, bundles: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`bundle-key-${i}`} className="text-xs">
                        Key
                      </Label>
                      <Input id={`bundle-key-${i}`} placeholder="ex: starter" value={row.key} onChange={(e) => update({ ...row, key: e.target.value })} />
                    </div>
                    <div className="w-40 space-y-1">
                      <Label htmlFor={`bundle-label-${i}`} className="text-xs">
                        Etichetă
                      </Label>
                      <Input
                        id={`bundle-label-${i}`}
                        placeholder="ex: Pachet Starter"
                        value={row.label}
                        onChange={(e) => update({ ...row, label: e.target.value })}
                      />
                    </div>
                    <div className="w-28 space-y-1">
                      <Label htmlFor={`bundle-price-${i}`} className="text-xs">
                        Preț fix (EUR/lună)
                      </Label>
                      <Input
                        id={`bundle-price-${i}`}
                        inputMode="decimal"
                        value={row.price}
                        onChange={(e) => update({ ...row, price: e.target.value })}
                      />
                    </div>
                    <div className="w-28 space-y-1">
                      <Label htmlFor={`bundle-onboarding-${i}`} className="text-xs">
                        Configurare (EUR, one-time)
                      </Label>
                      <Input
                        id={`bundle-onboarding-${i}`}
                        inputMode="decimal"
                        value={row.onboardingPrice}
                        onChange={(e) => update({ ...row, onboardingPrice: e.target.value })}
                      />
                    </div>
                    <div className="w-full space-y-1 border-t pt-2">
                      <Label className="text-xs text-muted-foreground">
                        Preset calculator (opțional — precompletează, rămâne editabil; gol = neschimbat)
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`bundle-puncte-${i}`} className="text-xs">
                            Puncte de lucru
                          </Label>
                          <Input
                            id={`bundle-puncte-${i}`}
                            inputMode="numeric"
                            value={row.puncteLucru}
                            onChange={(e) => update({ ...row, puncteLucru: e.target.value })}
                          />
                        </div>
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`bundle-op-desktop-${i}`} className="text-xs">
                            Operatori desktop
                          </Label>
                          <Input
                            id={`bundle-op-desktop-${i}`}
                            inputMode="numeric"
                            value={row.operatoriDesktop}
                            onChange={(e) => update({ ...row, operatoriDesktop: e.target.value })}
                          />
                        </div>
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`bundle-op-mobil-${i}`} className="text-xs">
                            Operatori mobil
                          </Label>
                          <Input
                            id={`bundle-op-mobil-${i}`}
                            inputMode="numeric"
                            value={row.operatoriMobil}
                            onChange={(e) => update({ ...row, operatoriMobil: e.target.value })}
                          />
                        </div>
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`bundle-documente-${i}`} className="text-xs">
                            Documente/lună
                          </Label>
                          <Input
                            id={`bundle-documente-${i}`}
                            inputMode="numeric"
                            value={row.documente}
                            onChange={(e) => update({ ...row, documente: e.target.value })}
                          />
                        </div>
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`bundle-cantare-${i}`} className="text-xs">
                            Cântare smart
                          </Label>
                          <Input
                            id={`bundle-cantare-${i}`}
                            inputMode="numeric"
                            value={row.cantare}
                            onChange={(e) => update({ ...row, cantare: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="min-w-[16rem] flex-1 space-y-1">
                      <Label className="text-xs">Add-on-uri incluse</Label>
                      {form.addons.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Adaugă întâi add-on-uri mai sus.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {form.addons.map((addon, addonIndex) => (
                            <label key={addonIndex} className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={row.addonKeys.includes(addon.key)}
                                onChange={(e) =>
                                  update({
                                    ...row,
                                    addonKeys: e.target.checked ? [...row.addonKeys, addon.key] : row.addonKeys.filter((k) => k !== addon.key),
                                  })
                                }
                              />
                              {addon.label || addon.key}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button type="button" variant="outline" onClick={remove}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                onAdd={() =>
                  setForm((f) => ({
                    ...f,
                    bundles: [
                      ...f.bundles,
                      {
                        key: '',
                        label: '',
                        addonKeys: [],
                        price: '',
                        puncteLucru: '',
                        operatoriDesktop: '',
                        operatoriMobil: '',
                        documente: '',
                        cantare: '',
                        onboardingPrice: '',
                      },
                    ],
                  }))
                }
                addLabel="Adaugă pachet"
              />

              <BandEditor
                title="Benzi documente (peste cota inclusă)"
                rows={form.documentBands}
                onChange={(rows) => setForm((f) => ({ ...f, documentBands: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`doc-band-upto-${i}`} className="text-xs">
                        Până la (gol = ∞)
                      </Label>
                      <Input id={`doc-band-upto-${i}`} inputMode="numeric" value={row.upTo} onChange={(e) => update({ ...row, upTo: e.target.value })} />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`doc-band-rate-${i}`} className="text-xs">
                        Rată/doc (gol = manual)
                      </Label>
                      <Input id={`doc-band-rate-${i}`} inputMode="decimal" value={row.rate} onChange={(e) => update({ ...row, rate: e.target.value })} />
                    </div>
                    <Button type="button" variant="outline" disabled={form.documentBands.length === 1} onClick={remove}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                onAdd={() => setForm((f) => ({ ...f, documentBands: [...f.documentBands, { upTo: '', rate: '' }] }))}
              />

              <p className="text-xs text-muted-foreground">
                Multiplierul benzii de mai jos se aplică la <strong>ambele</strong>: prețul de bază lunar ȘI taxa de
                inițiere (onboarding).
              </p>
              <BandEditor
                title="Benzi puncte de lucru → multiplier"
                rows={form.puncteBands}
                onChange={(rows) => setForm((f) => ({ ...f, puncteBands: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`puncte-band-max-${i}`} className="text-xs">
                        Puncte până la (gol = ∞)
                      </Label>
                      <Input id={`puncte-band-max-${i}`} inputMode="numeric" value={row.max} onChange={(e) => update({ ...row, max: e.target.value })} />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label htmlFor={`puncte-band-mult-${i}`} className="text-xs">
                        Multiplier
                      </Label>
                      <Input id={`puncte-band-mult-${i}`} inputMode="decimal" value={row.mult} onChange={(e) => update({ ...row, mult: e.target.value })} />
                    </div>
                    <div className="w-40 space-y-1">
                      <Label htmlFor={`puncte-band-label-${i}`} className="text-xs">
                        Etichetă
                      </Label>
                      <Input id={`puncte-band-label-${i}`} value={row.label} onChange={(e) => update({ ...row, label: e.target.value })} />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`puncte-band-plan-${i}`} className="text-xs">
                        Nume plan (opțional)
                      </Label>
                      <Input
                        id={`puncte-band-plan-${i}`}
                        placeholder="ex: Business"
                        value={row.planName}
                        onChange={(e) => update({ ...row, planName: e.target.value })}
                      />
                    </div>
                    <Button type="button" variant="outline" disabled={form.puncteBands.length === 1} onClick={remove}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                onAdd={() => setForm((f) => ({ ...f, puncteBands: [...f.puncteBands, { max: '', mult: '', label: '', planName: '' }] }))}
              />

              <BandEditor
                title="Echipamente (semnat digital, scanner acte etc.)"
                rows={form.equipmentItems}
                onChange={(rows) => setForm((f) => ({ ...f, equipmentItems: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={row.id} className="flex flex-wrap items-end gap-2">
                    <div className="w-56 space-y-1">
                      <Label htmlFor={`equip-name-${i}`} className="text-xs">
                        Nume echipament
                      </Label>
                      <Input
                        id={`equip-name-${i}`}
                        placeholder="ex: Signature pad STU-430"
                        value={row.name}
                        onChange={(e) => update({ ...row, name: e.target.value })}
                      />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`equip-purchase-${i}`} className="text-xs">
                        Achiziție (one-time)
                      </Label>
                      <Input
                        id={`equip-purchase-${i}`}
                        inputMode="decimal"
                        value={row.purchasePrice}
                        onChange={(e) => update({ ...row, purchasePrice: e.target.value })}
                      />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`equip-integration-${i}`} className="text-xs">
                        Integrare (one-time)
                      </Label>
                      <Input
                        id={`equip-integration-${i}`}
                        inputMode="decimal"
                        value={row.integrationPrice}
                        onChange={(e) => update({ ...row, integrationPrice: e.target.value })}
                      />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`equip-monthly-${i}`} className="text-xs">
                        Abonament/lună
                      </Label>
                      <Input
                        id={`equip-monthly-${i}`}
                        inputMode="decimal"
                        value={row.monthlyFee}
                        onChange={(e) => update({ ...row, monthlyFee: e.target.value })}
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={remove}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                onAdd={() =>
                  setForm((f) => ({
                    ...f,
                    equipmentItems: [
                      ...f.equipmentItems,
                      { id: crypto.randomUUID(), name: '', purchasePrice: '', integrationPrice: '', monthlyFee: '' },
                    ],
                  }))
                }
                addLabel="Adaugă echipament"
              />

              <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
                {saveConfig.isPending ? 'Se salvează…' : 'Salvează config-ul'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <PlatformTemplatesSection platformId={platformId} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// Kill-switch (Stefan, 2026-08-04) — global, nu per-platformă: oprește afișarea prețului în
// wizard-ul self-serve din recyclers_app (POST /api/v1/integrations/vanagreen/pricing/calculate
// răspunde non-2xx cât timp e OFF, recyclers_app arată "te contactăm noi", non-blocant).
// Nu afectează calculatorul manual de mai jos (folosit de Stefan direct, autentificat).
function SelfServePricingToggleCard() {
  const queryClient = useQueryClient()

  const toggleState = useQuery({
    queryKey: ['pricing', 'self-serve-toggle'],
    queryFn: () => api.get<{ enabled: boolean }>('/api/pricing/self-serve-toggle'),
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.put<{ enabled: boolean }>('/api/pricing/self-serve-toggle', { enabled }),
    onSuccess: (data) => {
      queryClient.setQueryData(['pricing', 'self-serve-toggle'], data)
      toast.success(data.enabled ? 'Preț self-serve pornit' : 'Preț self-serve oprit')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preț self-serve (recyclers_app)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Wizard-ul de signup self-serve din recyclers_app cere prețul live de aici. Cu comutatorul oprit, wizard-ul
          arată „te contactăm noi" în loc de preț — util dacă te răzgândești pe strategia de preț și vrei să oprești
          rapid afișarea, fără deploy.
        </p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={toggleState.data?.enabled ?? true}
            disabled={toggleState.isPending || toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
          Preț self-serve ON
        </label>
      </CardContent>
    </Card>
  )
}

function BandEditor<T>({
  title,
  rows,
  onChange,
  renderRow,
  onAdd,
  addLabel = 'Adaugă bandă',
}: {
  title: string
  rows: T[]
  onChange: (rows: T[]) => void
  renderRow: (row: T, index: number, update: (row: T) => void, remove: () => void) => React.ReactNode
  onAdd: () => void
  addLabel?: string
}) {
  return (
    <div className="space-y-2 border-t pt-4">
      <Label className="text-sm font-semibold">{title}</Label>
      <div className="space-y-2">
        {rows.map((row, i) =>
          renderRow(
            row,
            i,
            (updated) => onChange(rows.map((r, idx) => (idx === i ? updated : r))),
            () => onChange(rows.filter((_, idx) => idx !== i)),
          ),
        )}
      </div>
      <Button type="button" variant="outline" onClick={onAdd}>
        <Plus className="h-4 w-4" /> {addLabel}
      </Button>
    </div>
  )
}
