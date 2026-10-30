import type { PricingBreakdownRow, PricingCalculateInput, PricingPuncteBand, PricingConfig, PricingResult } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// Mirror 1:1 al backend/src/modules/pricing/calc.ts — folosit DOAR ca fallback offline
// (PricingPage, la eșec de rețea pe /api/pricing/calculate). Ține sincron cu backend-ul —
// gardat de testul de paritate calc.test.ts.

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function addonLine(addon: PricingConfig['addons'][number], quantity: number): { total: number; label: string } {
  if (!addon.bands?.length) return { total: addon.price, label: `Add-on: ${addon.label}` }
  const band = addon.bands.find((b) => b.upTo === null || quantity <= b.upTo) ?? addon.bands[addon.bands.length - 1]!
  return { total: quantity * band.unitPrice, label: t('pricing:breakdown.addonWithQuantity', { label: addon.label, quantity, unitPrice: band.unitPrice }) }
}

function puncteMultiplier(puncte: number, bands: PricingPuncteBand[]): PricingPuncteBand {
  for (const band of bands) {
    if (band.max === null || puncte <= band.max) return band
  }
  return bands[bands.length - 1]!
}

function docOverage(
  documente: number,
  documenteIncluse: number,
  bands: PricingConfig['documentBands'],
): { total: number; manual: boolean } {
  let remaining = Math.max(0, documente - documenteIncluse)
  let total = 0
  let prevUpTo = documenteIncluse
  for (const band of bands) {
    if (remaining <= 0) break
    if (band.rate === null) return { total, manual: true }
    const bandUpTo = band.upTo === null ? Infinity : band.upTo
    const bandSize = bandUpTo - prevUpTo
    const used = Math.min(remaining, bandSize)
    total += used * band.rate
    remaining -= used
    prevUpTo = bandUpTo
  }
  return { total, manual: false }
}

export function calculatePrice(config: PricingConfig, input: PricingCalculateInput): PricingResult {
  const opDesktop = Math.max(1, input.opDesktop)
  const puncte = Math.max(1, input.puncte)

  const band = puncteMultiplier(puncte, config.puncteBands)
  const base = config.basePrice * band.mult

  const extraOpDesktop = Math.max(0, opDesktop - 1) * config.operatorDesktopRate
  const extraOpMobil = input.opMobil * config.operatorMobilRate
  const { total: extraDoc, manual: docManual } = docOverage(input.documente, config.documenteIncluse, config.documentBands)
  const fluxDelta = input.flux === 'deee' ? config.fluxDeeeDelta : 0

  const bundle = input.selectedBundleKey ? config.bundles.find((b) => b.key === input.selectedBundleKey) : undefined
  const bundleAddonKeys = new Set(bundle?.addonKeys ?? [])
  const bundleModulesTotal = config.addons
    .filter((a) => bundleAddonKeys.has(a.key))
    .reduce((sum, a) => sum + addonLine(a, input.addonQuantities?.[a.key] ?? 1).total, 0)
  const bundleTotal = bundleModulesTotal * (1 - (bundle?.discountPercent ?? 0) / 100)

  const selectedAddonKeys = new Set(input.selectedAddonKeys)
  const selectedAddons = config.addons.filter((a) => selectedAddonKeys.has(a.key) && !bundleAddonKeys.has(a.key))
  let addonsTotal = 0
  const addonBreakdownRows: PricingBreakdownRow[] = []
  for (const addon of selectedAddons) {
    const line = addonLine(addon, input.addonQuantities?.[addon.key] ?? 1)
    addonsTotal += line.total
    addonBreakdownRows.push({ label: line.label, value: round2(line.total) })
  }

  const siatdTotal =
    input.siatd > 0 ? config.siatdFloorPrice + Math.max(0, input.siatd - config.siatdFloorUnits) * config.siatdUnitPrice : 0

  const cantarTotal = input.cantare * config.cantarRate

  // Sprint 4 — echipamente fizice selectate pt. clientul ăsta.
  const selectedEquipment = config.equipmentItems.filter((e) => input.selectedEquipmentIds.includes(e.id))
  const equipmentPurchaseTotal = selectedEquipment.reduce((s, e) => s + e.purchasePrice, 0)
  const equipmentIntegrationTotal = selectedEquipment.reduce((s, e) => s + e.integrationPrice, 0)
  const equipmentMonthlyTotal = selectedEquipment.reduce((s, e) => s + e.monthlyFee, 0)

  const monthlySubtotal =
    base + extraOpDesktop + extraOpMobil + extraDoc + fluxDelta + bundleTotal + addonsTotal + siatdTotal + cantarTotal + equipmentMonthlyTotal
  const monthlyDiscount = monthlySubtotal * (config.discountPercent / 100)
  const totalMonthly = monthlySubtotal - monthlyDiscount
  const totalAnnual = totalMonthly * config.lunileAnuale

  const hours = input.onboardingHours ?? bundle?.onboardingHours ?? config.onboardingDefaultHours
  const marginPercent = input.onboardingMarginPercent ?? config.onboardingMarginPercent
  const billedHours = hours * (1 + marginPercent / 100)
  const onboardingLabor = billedHours * config.onboardingHourlyRate + equipmentIntegrationTotal
  const onboardingDiscount = onboardingLabor * (config.discountPercent / 100)
  const onboardingTotal = onboardingLabor - onboardingDiscount + equipmentPurchaseTotal

  const breakdown: PricingBreakdownRow[] = [
    { label: t('pricing:breakdown.base', { label: band.label, mult: band.mult }), value: round2(base) },
    { label: t('pricing:breakdown.extraDesktop', { count: Math.max(0, opDesktop - 1), rate: config.operatorDesktopRate }), value: round2(extraOpDesktop) },
    { label: t('pricing:breakdown.mobile', { opMobil: input.opMobil, operatorMobilRate: config.operatorMobilRate }), value: round2(extraOpMobil) },
    { label: t('pricing:breakdown.extraDocuments', { count: Math.max(0, input.documente - config.documenteIncluse) }), value: round2(extraDoc) },
    { label: t('pricing:breakdown.deeeFlow'), value: round2(fluxDelta) },
    {
      label: bundle
        ? t('pricing:breakdown.bundle', { label: bundle.label, modules: round2(bundleModulesTotal), discount: bundle.discountPercent })
        : t('pricing:breakdown.noBundle'),
      value: round2(bundleTotal),
    },
    ...addonBreakdownRows,
    { label: t('pricing:breakdown.siatd', { siatd: input.siatd }), value: round2(siatdTotal) },
    { label: t('pricing:breakdown.scales', { cantare: input.cantare, cantarRate: config.cantarRate }), value: round2(cantarTotal) },
    { label: t('pricing:breakdown.equipmentPurchase'), value: round2(equipmentPurchaseTotal) },
    { label: t('pricing:breakdown.equipmentIntegration'), value: round2(equipmentIntegrationTotal) },
    { label: t('pricing:breakdown.equipmentSubscription'), value: round2(equipmentMonthlyTotal) },
    ...(monthlyDiscount ? [{ label: t('pricing:breakdown.campaignDiscount', { percent: config.discountPercent }), value: -round2(monthlyDiscount) }] : []),
    {
      label: t('pricing:breakdown.setupFee', { hours, margin: marginPercent, billedHours: round2(billedHours), rate: config.onboardingHourlyRate }),
      value: round2(billedHours * config.onboardingHourlyRate),
    },
    ...(onboardingDiscount ? [{ label: t('pricing:breakdown.setupDiscount', { percent: config.discountPercent }), value: -round2(onboardingDiscount) }] : []),
  ]

  return {
    totalMonthly: round2(totalMonthly),
    totalAnnual: round2(totalAnnual),
    onboardingTotal: round2(onboardingTotal),
    onboardingHours: round2(billedHours),
    manualReviewNeeded: docManual,
    planName: band.planName ?? null,
    breakdown,
  }
}

/** Monthly price of a bundle at its preset configuration, the same figure the price sheet shows. */
export function bundleMonthlyTotal(config: PricingConfig, bundle: PricingConfig['bundles'][number]): number {
  return calculatePrice(config, {
    platformId: '',
    flux: 'standard',
    opDesktop: bundle.operatoriDesktop ?? 1,
    opMobil: bundle.operatoriMobil ?? 0,
    puncte: bundle.puncteLucru ?? 1,
    documente: bundle.documente ?? config.documenteIncluse,
    siatd: 0,
    selectedEquipmentIds: [],
    selectedAddonKeys: [],
    selectedBundleKey: bundle.key,
    cantare: bundle.cantare ?? 0,
    onboardingHours: null,
    onboardingMarginPercent: null,
  }).totalMonthly
}
