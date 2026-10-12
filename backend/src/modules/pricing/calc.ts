import type { PricingCalculateInput, PricingConfig } from './schema.js'

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
  manualReviewNeeded: boolean
  planName: string | null
  breakdown: PricingBreakdownRow[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
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

  // Bundle-uri (2026-08-20) — preț FIX per pachet, combinabil cu add-on-uri individuale.
  // Add-on-urile deja incluse în pachet sunt EXCLUSE din suma individuală de mai jos — apărare
  // structurală contra dublei taxări, indiferent ce trimite apelantul (self-serve inclus).
  const bundle = input.selectedBundleKey ? config.bundles.find((b) => b.key === input.selectedBundleKey) : undefined
  const bundleAddonKeys = new Set(bundle?.addonKeys ?? [])
  const bundleTotal = bundle?.price ?? 0

  // Catalog generic (Wave 0/1, sprint de-hardcodare 2026-08-20) — sumează pe `key`, nu pe
  // câmpuri numite, ca add-on-urile noi adăugate din Config preț să funcționeze fără cod nou.
  // Benzi pe cantitate (2026-08-25): cantitatea cade într-o singură treaptă și se taxează
  // cantitate × unitPrice-ul treptei (citabil direct clientului: "10-49 angajați → X RON/angajat").
  // Fără benzi = preț fix × cantitatea implicită 1.
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
    const quantity = input.addonQuantities[addon.key] ?? 1
    const band = addon.bands.find((b) => b.upTo === null || quantity <= b.upTo) ?? addon.bands[addon.bands.length - 1]!
    const lineTotal = quantity * band.unitPrice
    addonsTotal += lineTotal
    addonBreakdownRows.push({
      label: `Add-on: ${addon.label} (${quantity} × ${band.unitPrice})`,
      value: round2(lineTotal),
    })
  }

  const siatdTotal =
    input.siatd > 0 ? config.siatdFloorPrice + Math.max(0, input.siatd - config.siatdFloorUnits) * config.siatdUnitPrice : 0

  // Legătură cântar smart (Stefan, 2026-08-07) — preț PER cântar conectat, nu boolean.
  const cantarTotal = input.cantare * config.cantarRate
  // Configurare cântare smart (Stefan, 2026-08-19) — taxă one-time, o singură dată per client
  // (nu per cântar), gate pe cantare > 0, la fel ca onboardingSiatdCost mai jos.
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

  return {
    totalMonthly: round2(totalMonthly),
    totalAnnual: round2(totalAnnual),
    onboardingTotal: round2(onboardingTotal),
    manualReviewNeeded: docManual,
    planName: band.planName ?? null,
    breakdown: [
      { label: `Bază (banda puncte de lucru: ${band.label}, ×${band.mult})`, value: round2(base) },
      { label: `Operatori desktop extra (${Math.max(0, opDesktop - 1)} × ${config.operatorDesktopRate})`, value: round2(extraOpDesktop) },
      { label: `Operatori mobil (${input.opMobil} × ${config.operatorMobilRate})`, value: round2(extraOpMobil) },
      { label: `Documente extra (${Math.max(0, input.documente - config.documenteIncluse)}, pe benzi)`, value: round2(extraDoc) },
      { label: 'Flux DEEE/DBA', value: round2(fluxDelta) },
      { label: bundle ? `Pachet: ${bundle.label}` : 'Niciun pachet ales', value: round2(bundleTotal) },
      ...addonBreakdownRows,
      { label: `Robot SIATD (${input.siatd} intrări)`, value: round2(siatdTotal) },
      { label: `Cântare smart conectate (${input.cantare} × ${config.cantarRate})`, value: round2(cantarTotal) },
      { label: 'Configurare cântare smart (one-time)', value: round2(cantarSetupCost) },
      { label: 'Echipamente — achiziție (one-time)', value: round2(equipmentPurchaseTotal) },
      { label: 'Echipamente — integrare (one-time)', value: round2(equipmentIntegrationTotal) },
      { label: 'Echipamente — abonament lunar', value: round2(equipmentMonthlyTotal) },
      {
        label: bundle ? `Taxă de inițiere — preț fix pachet „${bundle.label}" (one-time)` : 'Taxă de inițiere (onboarding, one-time)',
        value: round2(onboardingTotal),
      },
    ],
  }
}
