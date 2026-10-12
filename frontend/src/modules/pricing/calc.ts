import type { PricingBreakdownRow, PricingCalculateInput, PricingPuncteBand, PricingConfig, PricingResult } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// Mirror 1:1 al backend/src/modules/pricing/calc.ts — folosit DOAR ca fallback offline
// (PricingPage, la eșec de rețea pe /api/pricing/calculate). Ține sincron cu backend-ul —
// gardat de testul de paritate calc.test.ts.

function round2(n: number): number {
  return Math.round(n * 100) / 100
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
  const bundleTotal = bundle?.price ?? 0

  const selectedAddonKeys = new Set(input.selectedAddonKeys)
  const selectedAddons = config.addons.filter((a) => selectedAddonKeys.has(a.key) && !bundleAddonKeys.has(a.key))
  let addonsTotal = 0
  const addonBreakdownRows: PricingBreakdownRow[] = []
  for (const addon of selectedAddons) {
    if (!addon.bands?.length) {
      addonsTotal += addon.price
      addonBreakdownRows.push({ label: `Add-on: ${addon.label}`, value: round2(addon.price) })
      continue
    }
    const quantity = input.addonQuantities?.[addon.key] ?? 1
    const band = addon.bands.find((b) => b.upTo === null || quantity <= b.upTo) ?? addon.bands[addon.bands.length - 1]!
    const lineTotal = quantity * band.unitPrice
    addonsTotal += lineTotal
    addonBreakdownRows.push({ label: t('pricing:breakdown.addonWithQuantity', { label: addon.label, quantity, unitPrice: band.unitPrice }), value: round2(lineTotal) })
  }

  const siatdTotal =
    input.siatd > 0 ? config.siatdFloorPrice + Math.max(0, input.siatd - config.siatdFloorUnits) * config.siatdUnitPrice : 0

  const cantarTotal = input.cantare * config.cantarRate
  const cantarSetupCost = input.cantare > 0 ? config.cantarSetupPrice : 0

  // Sprint 4 — echipamente fizice selectate pt. clientul ăsta.
  const selectedEquipment = config.equipmentItems.filter((e) => input.selectedEquipmentIds.includes(e.id))
  const equipmentPurchaseTotal = selectedEquipment.reduce((s, e) => s + e.purchasePrice, 0)
  const equipmentIntegrationTotal = selectedEquipment.reduce((s, e) => s + e.integrationPrice, 0)
  const equipmentMonthlyTotal = selectedEquipment.reduce((s, e) => s + e.monthlyFee, 0)

  const totalMonthly =
    base + extraOpDesktop + extraOpMobil + extraDoc + fluxDelta + bundleTotal + addonsTotal + siatdTotal + cantarTotal + equipmentMonthlyTotal
  const totalAnnual = totalMonthly * config.lunileAnuale

  const onboardingBaseCost = config.onboardingBase * band.mult
  const onboardingOpCost = Math.max(0, opDesktop - 1) * config.onboardingOpRate
  const onboardingDeeeCost = input.flux === 'deee' ? config.onboardingDeeeDelta : 0
  const onboardingSiatdCost = input.siatd > 0 ? config.onboardingSiatdSetup : 0
  // Bundle selectat → ÎNLOCUIEȘTE COMPLET formula normală de onboarding cu taxa fixă a
  // pachetului (nu se adună cu ea) — decizie explicită Stefan, 2026-08-20.
  const onboardingTotal = bundle
    ? bundle.onboardingPrice
    : onboardingBaseCost +
      onboardingOpCost +
      onboardingDeeeCost +
      onboardingSiatdCost +
      cantarSetupCost +
      equipmentPurchaseTotal +
      equipmentIntegrationTotal

  const breakdown: PricingBreakdownRow[] = [
    { label: t('pricing:breakdown.base', { label: band.label, mult: band.mult }), value: round2(base) },
    { label: t('pricing:breakdown.extraDesktop', { count: Math.max(0, opDesktop - 1), rate: config.operatorDesktopRate }), value: round2(extraOpDesktop) },
    { label: t('pricing:breakdown.mobile', { opMobil: input.opMobil, operatorMobilRate: config.operatorMobilRate }), value: round2(extraOpMobil) },
    { label: t('pricing:breakdown.extraDocuments', { count: Math.max(0, input.documente - config.documenteIncluse) }), value: round2(extraDoc) },
    { label: t('pricing:breakdown.deeeFlow'), value: round2(fluxDelta) },
    { label: bundle ? `Pachet: ${bundle.label}` : t('pricing:breakdown.noBundle'), value: round2(bundleTotal) },
    ...addonBreakdownRows,
    { label: t('pricing:breakdown.siatd', { siatd: input.siatd }), value: round2(siatdTotal) },
    { label: t('pricing:breakdown.scales', { cantare: input.cantare, cantarRate: config.cantarRate }), value: round2(cantarTotal) },
    { label: t('pricing:breakdown.scalesSetup'), value: round2(cantarSetupCost) },
    { label: t('pricing:breakdown.equipmentPurchase'), value: round2(equipmentPurchaseTotal) },
    { label: t('pricing:breakdown.equipmentIntegration'), value: round2(equipmentIntegrationTotal) },
    { label: t('pricing:breakdown.equipmentSubscription'), value: round2(equipmentMonthlyTotal) },
    {
      label: bundle ? t('pricing:breakdown.setupFeeBundle', { label: bundle.label }) : t('pricing:breakdown.setupFee'),
      value: round2(onboardingTotal),
    },
  ]

  return {
    totalMonthly: round2(totalMonthly),
    totalAnnual: round2(totalAnnual),
    onboardingTotal: round2(onboardingTotal),
    manualReviewNeeded: docManual,
    planName: band.planName ?? null,
    breakdown,
  }
}
