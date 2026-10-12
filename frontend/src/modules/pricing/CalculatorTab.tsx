import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { downloadCsv } from '@/shared/lib/csv'
import type { BillingClient, Platform, PricingCalculateInput, PricingConfigRow, PricingResult, Prospect } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { formatNumber } from '@/shared/lib/format'
import { calculatePrice } from './calc'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

function exportCalculatorCsv(result: PricingResult, platformName: string) {
  downloadCsv(`calculator-pret-${new Date().toISOString().slice(0, 10)}.csv`, [
    [t('common:labels.platform'), platformName],
    ['Plan', result.planName ?? '—'],
    [t('pricing:calc.csv.monthlyTotal'), String(result.totalMonthly)],
    [t('pricing:calc.csv.yearlyTotal'), String(result.totalAnnual)],
    [t('pricing:calc.csv.setupFee'), String(result.onboardingTotal)],
    [],
    [t('pricing:calc.csv.component'), t('pricing:calc.csv.value')],
    ...result.breakdown.map((row) => [row.label, String(row.value)]),
  ])
}

const CALC_DEFAULTS: Omit<PricingCalculateInput, 'platformId'> = {
  flux: 'standard',
  opDesktop: 1,
  opMobil: 0,
  puncte: 1,
  documente: 150,
  siatd: 0,
  selectedEquipmentIds: [],
  selectedAddonKeys: [],
  selectedBundleKey: null,
  cantare: 0,
}

interface CalculatorTabProps {
  platformId: string
  setPlatformId: (id: string) => void
  platforms: Platform[]
}

export function CalculatorTab({ platformId, setPlatformId, platforms }: CalculatorTabProps) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [input, setInput] = useState(CALC_DEFAULTS)
  const [billingClientId, setBillingClientId] = useState('')
  const [localResult, setLocalResult] = useState<PricingResult | null>(null)
  // Toggle-uri UI-only (Stefan, 2026-08-07) — câmpurile numerice apar doar dacă bifezi
  // "Aplicație mobilă"/"Robot SIATD" întâi; nebifat => valoarea rămâne 0, fără input vizibil.
  const [mobilEnabled, setMobilEnabled] = useState(false)
  const [siatdEnabled, setSiatdEnabled] = useState(false)
  const [cantareEnabled, setCantareEnabled] = useState(false)

  const config = useQuery({
    queryKey: ['pricing', 'config', platformId],
    queryFn: () => api.get<PricingConfigRow | null>(`/api/pricing/config?platformId=${platformId}`),
    enabled: Boolean(platformId),
  })

  const clients = useQuery({ queryKey: ['billing-clients'], queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients') })

  // Vine din tab-ul Prospectare ("Calculează preț") — prefill opDesktop dintr-o aproximare a
  // numărului de angajați (Stefan ajustează manual, e doar punct de plecare, nu o conversie
  // exactă operatori↔angajați). Nu mai prefill-uim CA — scos din calculator 2026-08-01.
  const prospectId = searchParams.get('prospectId')
  const prospect = useQuery({
    queryKey: ['prospects', prospectId],
    queryFn: () => api.get<Prospect>(`/api/prospects/${prospectId}`),
    enabled: Boolean(prospectId),
  })

  useEffect(() => {
    if (!prospect.data) return
    setInput((i) => ({
      ...i,
      opDesktop: prospect.data.employeeCount ?? i.opDesktop,
    }))
    if (prospect.data.platformId) setPlatformId(prospect.data.platformId)
    // Curățăm query param-ul după prefill, ca un refresh să nu-l repopuleze peste editările lui Stefan.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('prospectId')
      return next
    })
  }, [prospect.data])

  const calc = useMutation({
    mutationFn: () => api.post<PricingResult>('/api/pricing/calculate', { platformId, ...input }),
    onMutate: () => setLocalResult(null),
    onError: (err) => {
      if (config.data?.config) setLocalResult(calculatePrice(config.data.config, { platformId, ...input }))
      toast.error(err.message)
    },
  })

  const result = calc.data ?? localResult
  const isLocalResult = !calc.data && Boolean(localResult)

  const applyToClient = useMutation({
    mutationFn: () =>
      api.patch(`/api/invoicing/clients/${billingClientId}`, {
        subscriptionPriceCurrency: 'eur',
        subscriptionPriceLei: null,
        subscriptionPriceEur: calc.data!.totalMonthly,
      }),
    // prețul e afișat și în lista de clienți din acest tab (['billing-clients'])
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
      toast.success(t('pricing:calc.csv.appliedPrice'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (!platformId) {
    return <p className="text-sm text-muted-foreground">{t('pricing:noPlatform')}</p>
  }

  if (config.isPending) return <Skeleton className="h-64 w-full" />
  if (!config.data?.config) {
    return <p className="text-sm text-muted-foreground">{t('pricing:calc.configureFirst')}</p>
  }

  const activeBundle = config.data.config.bundles.find((b) => b.key === input.selectedBundleKey)
  const activeBundleAddonKeys = new Set(activeBundle?.addonKeys ?? [])

  return (
    <div className="space-y-6">
      <div className="w-56 space-y-1">
        <Label htmlFor="calc-platform" className="text-xs text-muted-foreground">
          {t('common:labels.platform')}
        </Label>
        <Select
          id="calc-platform"
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>{t('pricing:tabs.calculator')}</CardTitle>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.open(`/api/pricing/price-sheet?platformId=${platformId}`, '_blank')}
          >
            <Download className="h-4 w-4" /> {t('pricing:calc.priceSheet')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="calc-flux" className="flex h-4 items-center text-xs">
                {t('pricing:calc.flow')}
              </Label>
              <Select
                id="calc-flux"
                value={input.flux}
                onChange={(e) => setInput((i) => ({ ...i, flux: e.target.value as 'standard' | 'deee' }))}
              >
                <option value="standard">{t('pricing:calc.flowStandard')}</option>
                <option value="deee">DEEE / DBA</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="calc-op-desktop" className="flex h-4 items-center text-xs">
                {t('pricing:fields.desktopOperators')}
              </Label>
              <Input id="calc-op-desktop" inputMode="numeric" value={input.opDesktop} onChange={(e) => setInput((i) => ({ ...i, opDesktop: parseRoDecimal(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1">
              <label htmlFor="calc-mobil-enabled" className="flex h-4 items-center gap-2 text-xs font-medium leading-none">
                <input
                  id="calc-mobil-enabled"
                  type="checkbox"
                  checked={mobilEnabled}
                  onChange={(e) => {
                    setMobilEnabled(e.target.checked)
                    if (!e.target.checked) setInput((i) => ({ ...i, opMobil: 0 }))
                  }}
                />
                {t('pricing:calc.mobileApp')}
              </label>
              <Input
                id="calc-op-mobil"
                inputMode="numeric"
                disabled={!mobilEnabled}
                placeholder={t('pricing:fields.mobileOperators')}
                value={input.opMobil}
                onChange={(e) => setInput((i) => ({ ...i, opMobil: parseRoDecimal(e.target.value) || 0 }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="calc-puncte" className="flex h-4 items-center text-xs">
                {t('pricing:fields.workSites')}
              </Label>
              <Input id="calc-puncte" inputMode="numeric" value={input.puncte} onChange={(e) => setInput((i) => ({ ...i, puncte: parseRoDecimal(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="calc-documente" className="flex h-4 items-center text-xs">
                {t('pricing:fields.documentsPerMonth')}
              </Label>
              <Input id="calc-documente" inputMode="numeric" value={input.documente} onChange={(e) => setInput((i) => ({ ...i, documente: parseRoDecimal(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1">
              <label htmlFor="calc-siatd-enabled" className="flex h-4 items-center gap-2 text-xs font-medium leading-none">
                <input
                  id="calc-siatd-enabled"
                  type="checkbox"
                  checked={siatdEnabled}
                  onChange={(e) => {
                    setSiatdEnabled(e.target.checked)
                    if (!e.target.checked) setInput((i) => ({ ...i, siatd: 0 }))
                  }}
                />
                {t('pricing:calc.siatdRobot')}
              </label>
              <Input
                id="calc-siatd"
                inputMode="numeric"
                disabled={!siatdEnabled}
                placeholder={t('pricing:calc.purchasesPerMonth')}
                value={input.siatd}
                onChange={(e) => setInput((i) => ({ ...i, siatd: parseRoDecimal(e.target.value) || 0 }))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="calc-cantare-enabled" className="flex h-4 items-center gap-2 text-xs font-medium leading-none">
                <input
                  id="calc-cantare-enabled"
                  type="checkbox"
                  checked={cantareEnabled}
                  onChange={(e) => {
                    setCantareEnabled(e.target.checked)
                    if (!e.target.checked) setInput((i) => ({ ...i, cantare: 0 }))
                  }}
                />
                {t('pricing:calc.connectedScales')}
              </label>
              <Input
                id="calc-cantare"
                inputMode="numeric"
                disabled={!cantareEnabled}
                placeholder={t('pricing:calc.scalesCount')}
                value={input.cantare}
                onChange={(e) => setInput((i) => ({ ...i, cantare: parseRoDecimal(e.target.value) || 0 }))}
              />
            </div>
          </div>
          {config.data.config.bundles.length > 0 ? (
            <div className="w-56 space-y-1">
              <Label htmlFor="calc-bundle" className="text-xs">
                {t('pricing:calc.bundle')}
              </Label>
              <Select
                id="calc-bundle"
                value={input.selectedBundleKey ?? ''}
                onChange={(e) => {
                  const bundleKey = e.target.value || null
                  const bundle = config.data!.config.bundles.find((b) => b.key === bundleKey)
                  // Preset UI-only (Stefan, 2026-08-20) — precompletează puncte/operatori/
                  // documente/cântare din bundle la selectare, dar rămân editabile după (nu se
                  // re-aplică la fiecare render, doar o dată, aici, la schimbarea select-ului).
                  setInput((i) => ({
                    ...i,
                    selectedBundleKey: bundleKey,
                    puncte: bundle?.puncteLucru ?? i.puncte,
                    opDesktop: bundle?.operatoriDesktop ?? i.opDesktop,
                    opMobil: bundle?.operatoriMobil ?? i.opMobil,
                    documente: bundle?.documente ?? i.documente,
                    cantare: bundle?.cantare ?? i.cantare,
                  }))
                  if (bundle?.operatoriMobil) setMobilEnabled(true)
                  if (bundle?.cantare) setCantareEnabled(true)
                }}
              >
                <option value="">{t('pricing:calc.noBundle')}</option>
                {config.data.config.bundles.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {config.data.config.addons.length > 0 ? (
            <div className="flex flex-wrap gap-4">
              {config.data.config.addons.map((addon) => {
                const includedInBundle = activeBundleAddonKeys.has(addon.key)
                const selected = input.selectedAddonKeys.includes(addon.key)
                const banded = Boolean(addon.bands?.length)
                return (
                  <div key={addon.key} className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={includedInBundle || selected}
                        disabled={includedInBundle}
                        title={includedInBundle ? t('pricing:calc.includedIn', { label: activeBundle?.label }) : undefined}
                        onChange={(e) =>
                          setInput((i) => ({
                            ...i,
                            selectedAddonKeys: e.target.checked
                              ? [...i.selectedAddonKeys, addon.key]
                              : i.selectedAddonKeys.filter((k) => k !== addon.key),
                          }))
                        }
                      />
                      {addon.label}
                    </label>
                    {banded && (selected || includedInBundle) ? (
                      <Input
                        inputMode="numeric"
                        value={input.addonQuantities?.[addon.key] ?? 1}
                        onChange={(e) =>
                          setInput((i) => ({
                            ...i,
                            addonQuantities: { ...i.addonQuantities, [addon.key]: Math.max(1, parseRoDecimal(e.target.value) || 1) },
                          }))
                        }
                        className="w-16 font-mono tnum"
                        aria-label={`Cantitate ${addon.label}`}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {config.data.config.equipmentItems.length > 0 ? (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-xs text-muted-foreground">{t('pricing:calc.equipment')}</Label>
              <div className="flex flex-wrap gap-4">
                {config.data.config.equipmentItems.map((equipment) => (
                  <label key={equipment.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={input.selectedEquipmentIds.includes(equipment.id)}
                      onChange={(e) =>
                        setInput((i) => ({
                          ...i,
                          selectedEquipmentIds: e.target.checked
                            ? [...i.selectedEquipmentIds, equipment.id]
                            : i.selectedEquipmentIds.filter((id) => id !== equipment.id),
                        }))
                      }
                    />
                    {equipment.name}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <Button onClick={() => calc.mutate()} disabled={calc.isPending}>
            {calc.isPending ? t('common:states.calculating') : t('pricing:calc.calculate')}
          </Button>

          {result && (
            <div className="space-y-3 rounded-md bg-muted/50 p-4">
              {isLocalResult && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning dark:bg-transparent">
                  {t('pricing:calc.offlineWarning')}
                </p>
              )}
              {result.manualReviewNeeded && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning dark:bg-transparent">
                  {t('pricing:calc.overThreshold')}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {result.planName ? (
                  <div className="inline-flex w-fit items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    {t('pricing:calc.plan', { planName: result.planName })}
                  </div>
                ) : (
                  <div />
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => exportCalculatorCsv(result, platforms.find((p) => p.id === platformId)?.name ?? platformId)}
                >
                  <Download className="h-4 w-4" /> {t('pricing:actions.exportCsv')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="text-xs text-muted-foreground">{t('common:labels.monthly')}</div>
                  <div className="text-xl font-bold">{formatNumber(result.totalMonthly, 'EUR')}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('common:labels.yearly')}</div>
                  <div className="text-xl font-bold">{formatNumber(result.totalAnnual, 'EUR')}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('pricing:calc.setupFee')}</div>
                  <div className="text-xl font-bold">{formatNumber(result.onboardingTotal, 'EUR')}</div>
                </div>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {result.breakdown.map((row) => (
                  <div key={row.label} className="flex justify-between border-b border-dashed py-0.5">
                    <span>{row.label}</span>
                    <span className="font-mono">{formatNumber(row.value, 'EUR')}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="min-w-[14rem] flex-1 space-y-1">
                  <Label htmlFor="calc-apply-client" className="text-xs">
                    {t('pricing:calc.applyToClient')}
                  </Label>
                  <Select
                    id="calc-apply-client"
                    value={billingClientId}
                    onChange={(e) => setBillingClientId(e.target.value)}
                  >
                    <option value="">{t('pricing:calc.pickClient')}</option>
                    {(clients.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!billingClientId || applyToClient.isPending || isLocalResult}
                  title={isLocalResult ? t('pricing:calc.offlineCannotApply') : undefined}
                  onClick={() => {
                    void confirm({ title: t('pricing:calc.applyTitle'), consequence: t('pricing:calc.applyBody'), confirmLabel: t('pricing:calc.applyConfirm') }).then((ok) => ok && applyToClient.mutate())
                  }}
                >
                  {t('pricing:calc.applyToClient')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
