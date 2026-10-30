import type { PricingCalculateInput, PricingConfig } from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

// Port 1:1 al funcțiilor pure `caMultiplier`/`docOverage`/`calc` din
// vanagreen-price-calculator.html (research Stefan) — server-side, ca să poată fi
// reutilizat și de auto-invoice pe viitor, nu doar de UI. Pure, fără DB/IO — testabil izolat.

export interface PricingBreakdownRow {
  label: string
  value: number
}

export interface PricingResult {
  totalMonthly: number
  totalAnnual: number
  onboardingTotal: number
  // Hours billed for setup, margin included.
  onboardingHours: number
  manualReviewNeeded: boolean
  planName: string | null
  breakdown: PricingBreakdownRow[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function addonLine(addon: PricingConfig['addons'][number], quantity: number): { total: number; label: string } {
  if (!addon.bands?.length) return { total: addon.price, label: `Add-on: ${addon.label}` }
  // Benzi pe cantitate (2026-08-25): cantitatea cade într-o singură treaptă și se taxează
  // cantitate × unitPrice-ul treptei (citabil direct clientului: "10-49 angajați → X RON/angajat").
  const band = addon.bands.find((b) => b.upTo === null || quantity <= b.upTo) ?? addon.bands[addon.bands.length - 1]!
  return { total: quantity * band.unitPrice, label: `Add-on: ${addon.label} (${quantity} × ${band.unitPrice})` }
}

function onboardingHours(
  config: PricingConfig,
  input: Pick<PricingCalculateInput, 'onboardingHours' | 'onboardingMarginPercent'>,
  bundle: PricingConfig['bundles'][number] | undefined,
) {
  const hours = input.onboardingHours ?? bundle?.onboardingHours ?? config.onboardingDefaultHours
  const marginPercent = input.onboardingMarginPercent ?? config.onboardingMarginPercent
  return { hours, marginPercent, billedHours: hours * (1 + marginPercent / 100) }
}

/**
 * What a bundle costs on its own, for the self-serve plan list: its modules after the bundle
 * and campaign discounts, and the setup fee at the bundle's default hours.
 */
export function bundleQuote(config: PricingConfig, bundle: PricingConfig['bundles'][number]) {
  const modules = config.addons.filter((a) => bundle.addonKeys.includes(a.key)).reduce((sum, a) => sum + addonLine(a, 1).total, 0)
  const keep = 1 - config.discountPercent / 100
  const { billedHours } = onboardingHours(config, { onboardingHours: null, onboardingMarginPercent: null }, bundle)
  return {
    price: round2(modules * (1 - bundle.discountPercent / 100) * keep),
    onboardingPrice: round2(billedHours * config.onboardingHourlyRate * keep),
  }
}

function puncteMultiplier(puncte: number, bands: PricingConfig['puncteBands']): PricingConfig['puncteBands'][number] {
  for (const band of bands) {
    if (band.max === null || puncte <= band.max) return band
  }
  return bands[bands.length - 1]!
}

/**
 * Documente peste cota inclusă, calculate pe benzi (rata scade la volum mare). Dacă se
 * ajunge la banda cu rate:null, NU se mai calculează automat — `manual:true`, iar apelantul
 * (routes.ts) marchează `manualReviewNeeded` — cifra întoarsă rămâne cea acumulată PÂNĂ la
 * acea bandă (parțială), nu e ascunsă, la fel ca avertismentul din HTML-ul original.
 */
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
  // Ca în HTML-ul original: opDesktop/puncte au mereu minim 1 (primul e inclus în bază),
  // opMobil/documente/siatd pot fi 0.
  const opDesktop = Math.max(1, input.opDesktop)
  const puncte = Math.max(1, input.puncte)

  // Axa de multiplier e puncte de lucru, NU cifra de afaceri (scoasă 2026-08-01) — vezi
  // comentariul din schema.ts. Folosim `puncte` (deja floor-at 1) ca să fie coerentă cu banda
  // aleasă și cu extraPuncte de mai jos.
  const band = puncteMultiplier(puncte, config.puncteBands)
  const base = config.basePrice * band.mult

  const extraOpDesktop = Math.max(0, opDesktop - 1) * config.operatorDesktopRate
  const extraOpMobil = input.opMobil * config.operatorMobilRate
  const { total: extraDoc, manual: docManual } = docOverage(input.documente, config.documenteIncluse, config.documentBands)
  const fluxDelta = input.flux === 'deee' ? config.fluxDeeeDelta : 0

  // Bundle = sum of its modules minus the bundle's percentage (Stefan, 2026-10-30). Add-ons in
  // the bundle are left out of the individual sum below, whatever the caller sends, so nothing
  // is charged twice.
  const bundle = input.selectedBundleKey ? config.bundles.find((b) => b.key === input.selectedBundleKey) : undefined
  const bundleAddonKeys = new Set(bundle?.addonKeys ?? [])
  const bundleModulesTotal = config.addons
    .filter((a) => bundleAddonKeys.has(a.key))
    .reduce((sum, a) => sum + addonLine(a, input.addonQuantities[a.key] ?? 1).total, 0)
  const bundleTotal = bundleModulesTotal * (1 - (bundle?.discountPercent ?? 0) / 100)

  const selectedAddonKeys = new Set(input.selectedAddonKeys)
  const selectedAddons = config.addons.filter((a) => selectedAddonKeys.has(a.key) && !bundleAddonKeys.has(a.key))
  let addonsTotal = 0
  const addonBreakdownRows: PricingBreakdownRow[] = []
  for (const addon of selectedAddons) {
    const line = addonLine(addon, input.addonQuantities[addon.key] ?? 1)
    addonsTotal += line.total
    addonBreakdownRows.push({ label: line.label, value: round2(line.total) })
  }

  const siatdTotal =
    input.siatd > 0 ? config.siatdFloorPrice + Math.max(0, input.siatd - config.siatdFloorUnits) * config.siatdUnitPrice : 0

  // Legătură cântar smart (Stefan, 2026-08-07) — preț PER cântar conectat, nu boolean.
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

  const onboarding = onboardingHours(config, input, bundle)
  const onboardingLabor = onboarding.billedHours * config.onboardingHourlyRate + equipmentIntegrationTotal
  // Equipment is bought at cost, so the campaign discount stays off it.
  const onboardingDiscount = onboardingLabor * (config.discountPercent / 100)
  const onboardingTotal = onboardingLabor - onboardingDiscount + equipmentPurchaseTotal

  return {
    totalMonthly: round2(totalMonthly),
    totalAnnual: round2(totalAnnual),
    onboardingTotal: round2(onboardingTotal),
    onboardingHours: round2(onboarding.billedHours),
    manualReviewNeeded: docManual,
    planName: band.planName ?? null,
    breakdown: [
      { label: tr('pricing.breakdown.base', { label: band.label, mult: band.mult }), value: round2(base) },
      { label: tr('pricing.breakdown.extraDesktop', { count: Math.max(0, opDesktop - 1), rate: config.operatorDesktopRate }), value: round2(extraOpDesktop) },
      { label: tr('pricing.breakdown.mobile', { opMobil: input.opMobil, operatorMobilRate: config.operatorMobilRate }), value: round2(extraOpMobil) },
      { label: tr('pricing.breakdown.extraDocuments', { count: Math.max(0, input.documente - config.documenteIncluse) }), value: round2(extraDoc) },
      { label: tr('pricing.breakdown.deeeFlow'), value: round2(fluxDelta) },
      {
        label: bundle
          ? tr('pricing.breakdown.bundle', { label: bundle.label, modules: round2(bundleModulesTotal), discount: bundle.discountPercent })
          : tr('pricing.breakdown.noBundle'),
        value: round2(bundleTotal),
      },
      ...addonBreakdownRows,
      { label: tr('pricing.breakdown.siatd', { siatd: input.siatd }), value: round2(siatdTotal) },
      { label: tr('pricing.breakdown.scales', { cantare: input.cantare, cantarRate: config.cantarRate }), value: round2(cantarTotal) },
      { label: tr('pricing.breakdown.equipmentPurchase'), value: round2(equipmentPurchaseTotal) },
      { label: 'Echipamente — integrare (one-time)', value: round2(equipmentIntegrationTotal) },
      { label: tr('pricing.breakdown.equipmentSubscription'), value: round2(equipmentMonthlyTotal) },
      ...(monthlyDiscount ? [{ label: tr('pricing.breakdown.campaignDiscount', { percent: config.discountPercent }), value: -round2(monthlyDiscount) }] : []),
      {
        label: tr('pricing.breakdown.setupFee', {
          hours: onboarding.hours,
          margin: onboarding.marginPercent,
          billedHours: round2(onboarding.billedHours),
          rate: config.onboardingHourlyRate,
        }),
        value: round2(onboarding.billedHours * config.onboardingHourlyRate),
      },
      ...(onboardingDiscount ? [{ label: tr('pricing.breakdown.setupDiscount', { percent: config.discountPercent }), value: -round2(onboardingDiscount) }] : []),
    ],
  }
}
