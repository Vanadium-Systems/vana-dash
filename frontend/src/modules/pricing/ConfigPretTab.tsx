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
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

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
  discountPercent: string
  puncteLucru: string // gol = fără preset
  operatoriDesktop: string
  operatoriMobil: string
  documente: string
  cantare: string
  onboardingHours: string // gol = orele implicite din config
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
  siatdFloorPrice: string
  siatdFloorUnits: string
  siatdUnitPrice: string
  lunileAnuale: string
  onboardingHourlyRate: string
  onboardingDefaultHours: string
  onboardingMarginPercent: string
  discountPercent: string
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
    siatdFloorPrice: '',
    siatdFloorUnits: '',
    siatdUnitPrice: '',
    lunileAnuale: '',
    onboardingHourlyRate: '',
    onboardingDefaultHours: '',
    onboardingMarginPercent: '',
    discountPercent: '',
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
      discountPercent: String(b.discountPercent),
      puncteLucru: b.puncteLucru === undefined ? '' : String(b.puncteLucru),
      operatoriDesktop: b.operatoriDesktop === undefined ? '' : String(b.operatoriDesktop),
      operatoriMobil: b.operatoriMobil === undefined ? '' : String(b.operatoriMobil),
      documente: b.documente === undefined ? '' : String(b.documente),
      cantare: b.cantare === undefined ? '' : String(b.cantare),
      onboardingHours: b.onboardingHours === undefined ? '' : String(b.onboardingHours),
    })),
    cantarRate: String(c.cantarRate),
    siatdFloorPrice: String(c.siatdFloorPrice),
    siatdFloorUnits: String(c.siatdFloorUnits),
    siatdUnitPrice: String(c.siatdUnitPrice),
    lunileAnuale: String(c.lunileAnuale),
    onboardingHourlyRate: String(c.onboardingHourlyRate),
    onboardingDefaultHours: String(c.onboardingDefaultHours),
    onboardingMarginPercent: String(c.onboardingMarginPercent),
    discountPercent: String(c.discountPercent),
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
      discountPercent: parseRoDecimal(b.discountPercent) || 0,
      puncteLucru: b.puncteLucru === '' ? undefined : parseRoDecimal(b.puncteLucru) || 0,
      operatoriDesktop: b.operatoriDesktop === '' ? undefined : parseRoDecimal(b.operatoriDesktop) || 0,
      operatoriMobil: b.operatoriMobil === '' ? undefined : parseRoDecimal(b.operatoriMobil) || 0,
      documente: b.documente === '' ? undefined : parseRoDecimal(b.documente) || 0,
      cantare: b.cantare === '' ? undefined : parseRoDecimal(b.cantare) || 0,
      onboardingHours: b.onboardingHours === '' ? undefined : parseRoDecimal(b.onboardingHours) || 0,
    })),
    cantarRate: parseRoDecimal(f.cantarRate) || 0,
    siatdFloorPrice: parseRoDecimal(f.siatdFloorPrice) || 0,
    siatdFloorUnits: parseRoDecimal(f.siatdFloorUnits) || 0,
    siatdUnitPrice: parseRoDecimal(f.siatdUnitPrice) || 0,
    lunileAnuale: parseRoDecimal(f.lunileAnuale) || 0,
    onboardingHourlyRate: parseRoDecimal(f.onboardingHourlyRate) || 0,
    onboardingDefaultHours: parseRoDecimal(f.onboardingDefaultHours) || 0,
    onboardingMarginPercent: parseRoDecimal(f.onboardingMarginPercent) || 0,
    discountPercent: parseRoDecimal(f.discountPercent) || 0,
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
  ['basePrice', t('pricing:config.fields.basePrice')],
  ['operatorDesktopRate', t('pricing:config.fields.extraDesktopRate')],
  ['operatorMobilRate', t('pricing:config.fields.mobileRate')],
  ['documenteIncluse', t('pricing:config.fields.documentsIncluded')],
  ['fluxDeeeDelta', t('pricing:config.fields.deeeDelta')],
  ['cantarRate', t('pricing:config.fields.scaleRate')],
  ['siatdFloorPrice', t('pricing:config.fields.siatdMin')],
  ['siatdFloorUnits', t('pricing:config.fields.siatdIncluded')],
  ['siatdUnitPrice', t('pricing:config.fields.siatdPerUnit')],
  ['lunileAnuale', t('pricing:config.fields.yearlyPaidMonths')],
  ['onboardingHourlyRate', t('pricing:config.fields.onboardingHourlyRate')],
  ['onboardingDefaultHours', t('pricing:config.fields.onboardingDefaultHours')],
  ['onboardingMarginPercent', t('pricing:config.fields.onboardingMarginPercent')],
  ['discountPercent', t('pricing:config.fields.campaignDiscount')],
]

function exportConfigCsv(config: PricingConfig, platformName: string) {
  downloadCsv(`config-pret-${new Date().toISOString().slice(0, 10)}.csv`, [
    [t('common:labels.platform'), platformName],
    [],
    ['Parametru', 'Valoare'],
    ...NUMERIC_FIELDS.map(([key, label]) => [label, String(config[key as keyof PricingConfig])]),
    [],
    ['Add-on-uri'],
    [t('pricing:config.key'), t('common:labels.label'), t('pricing:config.pricePerMonth')],
    ...config.addons.map((a) => [a.key, a.label, String(a.price)]),
    [],
    ['Pachete'],
    [
      t('pricing:config.key'),
      t('common:labels.label'),
      t('pricing:config.bundleDiscount'),
      t('pricing:config.setupHours'),
      t('pricing:fields.workSites'),
      t('pricing:fields.desktopOperators'),
      t('pricing:fields.mobileOperators'),
      t('pricing:fields.documentsPerMonth'),
      t('pricing:fields.smartScales'),
      t('pricing:config.includedAddons'),
    ],
    ...config.bundles.map((b) => [
      b.key,
      b.label,
      String(b.discountPercent),
      b.onboardingHours !== undefined ? String(b.onboardingHours) : '',
      b.puncteLucru !== undefined ? String(b.puncteLucru) : '',
      b.operatoriDesktop !== undefined ? String(b.operatoriDesktop) : '',
      b.operatoriMobil !== undefined ? String(b.operatoriMobil) : '',
      b.documente !== undefined ? String(b.documente) : '',
      b.cantare !== undefined ? String(b.cantare) : '',
      b.addonKeys.join('; '),
    ]),
    [],
    [t('pricing:config.csv.documentBands')],
    [t('common:labels.until'), t('pricing:config.csv.rate')],
    ...config.documentBands.map((band) => [band.upTo === null ? '∞' : String(band.upTo), band.rate === null ? 'manual' : String(band.rate)]),
    [],
    [t('pricing:config.csv.workSiteBands')],
    [t('common:labels.until'), t('pricing:config.multiplier'), t('common:labels.label'), t('common:nav.plan')],
    ...config.puncteBands.map((band) => [band.max === null ? '∞' : String(band.max), String(band.mult), band.label, band.planName ?? '']),
    [],
    ['Echipamente'],
    [t('common:labels.name'), t('pricing:config.csv.purchase'), t('pricing:config.csv.integration'), t('pricing:config.csv.monthlySubscription')],
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
      toast.success(t('pricing:config.saved'))
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
            {t('common:labels.platform')}
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
        <p className="text-sm text-muted-foreground">{t('pricing:noPlatform')}</p>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>{config.data?.config ? t('pricing:config.titleSaved') : t('pricing:config.titleUnsaved')}</CardTitle>
              {config.data?.config && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => exportConfigCsv(config.data!.config, platforms.find((p) => p.id === platformId)?.name ?? platformId)}
                >
                  <Download className="h-4 w-4" /> {t('pricing:actions.exportCsv')}
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
                title={t('pricing:config.addonsTitle')}
                rows={form.addons}
                onChange={(rows) => setForm((f) => ({ ...f, addons: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="space-y-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-40 space-y-1">
                        <Label htmlFor={`addon-key-${i}`} className="text-xs">
                          {t('pricing:config.addonKey')}
                        </Label>
                        <Input
                          id={`addon-key-${i}`}
                          placeholder={t('pricing:config.addonKeyPlaceholder')}
                          value={row.key}
                          onChange={(e) => update({ ...row, key: e.target.value })}
                        />
                      </div>
                      <div className="w-48 space-y-1">
                        <Label htmlFor={`addon-label-${i}`} className="text-xs">
                          {t('common:labels.label')}
                        </Label>
                        <Input
                          id={`addon-label-${i}`}
                          placeholder={t('pricing:config.addonLabelPlaceholder')}
                          value={row.label}
                          onChange={(e) => update({ ...row, label: e.target.value })}
                        />
                      </div>
                      {row.bands === undefined ? (
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`addon-price-${i}`} className="text-xs">
                            {t('pricing:config.pricePerMonth')}
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
                          {t('pricing:config.quantityBandsHint')}
                        </p>
                        {row.bands.map((band, bi) => (
                          <div key={bi} className="flex items-end gap-2">
                            <div className="w-28 space-y-1">
                              <Label htmlFor={`addon-band-up-${i}-${bi}`} className="text-xs text-muted-foreground">
                                {t('pricing:config.upToIncl')}
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
                                {t('pricing:config.pricePerUnit')}
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
                              aria-label={t('pricing:config.deleteBand')}
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
                            {t('pricing:config.addTier')}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => update({ ...row, bands: undefined })}>
                            {t('pricing:config.dropBands')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="ghost" onClick={() => update({ ...row, bands: [{ upTo: '', unitPrice: '' }] })}>
                        {t('pricing:config.priceByBands')}
                      </Button>
                    )}
                  </div>
                )}
                onAdd={() => setForm((f) => ({ ...f, addons: [...f.addons, { key: '', label: '', price: '' }] }))}
                addLabel={t('pricing:config.addAddon')}
              />

              <BandEditor
                title={t('pricing:config.bundlesTitle')}
                rows={form.bundles}
                onChange={(rows) => setForm((f) => ({ ...f, bundles: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`bundle-key-${i}`} className="text-xs">
                        Key
                      </Label>
                      <Input id={`bundle-key-${i}`} placeholder={t('pricing:config.bundleKeyPlaceholder')} value={row.key} onChange={(e) => update({ ...row, key: e.target.value })} />
                    </div>
                    <div className="w-40 space-y-1">
                      <Label htmlFor={`bundle-label-${i}`} className="text-xs">
                        {t('common:labels.label')}
                      </Label>
                      <Input
                        id={`bundle-label-${i}`}
                        placeholder={t('pricing:config.bundleLabelPlaceholder')}
                        value={row.label}
                        onChange={(e) => update({ ...row, label: e.target.value })}
                      />
                    </div>
                    <div className="w-28 space-y-1">
                      <Label htmlFor={`bundle-discount-${i}`} className="text-xs">
                        {t('pricing:config.bundleDiscount')}
                      </Label>
                      <Input
                        id={`bundle-discount-${i}`}
                        inputMode="decimal"
                        value={row.discountPercent}
                        onChange={(e) => update({ ...row, discountPercent: e.target.value })}
                      />
                    </div>
                    <div className="w-28 space-y-1">
                      <Label htmlFor={`bundle-onboarding-${i}`} className="text-xs">
                        {t('pricing:config.setupHours')}
                      </Label>
                      <Input
                        id={`bundle-onboarding-${i}`}
                        inputMode="decimal"
                        placeholder={form.onboardingDefaultHours}
                        value={row.onboardingHours}
                        onChange={(e) => update({ ...row, onboardingHours: e.target.value })}
                      />
                    </div>
                    <div className="w-full space-y-1 border-t pt-2">
                      <Label className="text-xs text-muted-foreground">
                        {t('pricing:config.presetHint')}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        <div className="w-32 space-y-1">
                          <Label htmlFor={`bundle-puncte-${i}`} className="text-xs">
                            {t('pricing:fields.workSites')}
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
                            {t('pricing:fields.desktopOperators')}
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
                            {t('pricing:fields.mobileOperators')}
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
                            {t('pricing:fields.documentsPerMonth')}
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
                            {t('pricing:fields.smartScales')}
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
                      <Label className="text-xs">{t('pricing:config.includedAddons')}</Label>
                      {form.addons.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('pricing:config.addAddonsFirst')}</p>
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
                        discountPercent: '',
                        puncteLucru: '',
                        operatoriDesktop: '',
                        operatoriMobil: '',
                        documente: '',
                        cantare: '',
                        onboardingHours: '',
                      },
                    ],
                  }))
                }
                addLabel={t('pricing:config.addBundle')}
              />

              <BandEditor
                title={t('pricing:config.documentBandsTitle')}
                rows={form.documentBands}
                onChange={(rows) => setForm((f) => ({ ...f, documentBands: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`doc-band-upto-${i}`} className="text-xs">
                        {t('pricing:config.upToEmptyInfinite')}
                      </Label>
                      <Input id={`doc-band-upto-${i}`} inputMode="numeric" value={row.upTo} onChange={(e) => update({ ...row, upTo: e.target.value })} />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`doc-band-rate-${i}`} className="text-xs">
                        {t('pricing:config.ratePerDoc')}
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
                {tNodes('pricing:config.multiplierNote', { both: <strong>{t('pricing:config.both')}</strong> })}
              </p>
              <BandEditor
                title={t('pricing:config.workSiteBandsTitle')}
                rows={form.puncteBands}
                onChange={(rows) => setForm((f) => ({ ...f, puncteBands: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`puncte-band-max-${i}`} className="text-xs">
                        {t('pricing:config.sitesUpTo')}
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
                        {t('common:labels.label')}
                      </Label>
                      <Input id={`puncte-band-label-${i}`} value={row.label} onChange={(e) => update({ ...row, label: e.target.value })} />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`puncte-band-plan-${i}`} className="text-xs">
                        {t('pricing:config.planNameOptional')}
                      </Label>
                      <Input
                        id={`puncte-band-plan-${i}`}
                        placeholder={t('pricing:config.planNamePlaceholder')}
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
                title={t('pricing:config.equipmentTitle')}
                rows={form.equipmentItems}
                onChange={(rows) => setForm((f) => ({ ...f, equipmentItems: rows }))}
                renderRow={(row, i, update, remove) => (
                  <div key={row.id} className="flex flex-wrap items-end gap-2">
                    <div className="w-56 space-y-1">
                      <Label htmlFor={`equip-name-${i}`} className="text-xs">
                        {t('pricing:config.equipmentName')}
                      </Label>
                      <Input
                        id={`equip-name-${i}`}
                        placeholder={t('pricing:config.equipmentPlaceholder')}
                        value={row.name}
                        onChange={(e) => update({ ...row, name: e.target.value })}
                      />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`equip-purchase-${i}`} className="text-xs">
                        {t('pricing:config.purchaseOneTime')}
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
                        {t('pricing:config.integrationOneTime')}
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
                        {t('pricing:config.subscriptionPerMonth')}
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
                addLabel={t('pricing:config.addEquipment')}
              />

              <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
                {saveConfig.isPending ? t('common:states.saving') : t('pricing:config.save')}
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
      toast.success(data.enabled ? t('pricing:config.selfServeOn') : t('pricing:config.selfServeOff'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pricing:config.selfServeTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('pricing:config.selfServeHint')}
        </p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={toggleState.data?.enabled ?? true}
            disabled={toggleState.isPending || toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
          {t('pricing:config.selfServeToggle')}
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
  addLabel = t('pricing:config.addBand'),
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
