/**
 * modules/pricing/calc.ts — port 1:1 al calculatorului din vanagreen-price-calculator.html
 * (research Stefan). Pure functions — verificăm fidelitatea portului cu valorile CONFIG
 * default din HTML-ul original, calculate manual din aceleași formule.
 */
import { describe, expect, it } from 'vitest'
import { calculatePrice } from './calc.js'
import type { PricingCalculateInput, PricingConfig } from './schema.js'

// 1:1 cu CONFIG din vanagreen-price-calculator.html.
const CONFIG: PricingConfig = {
  basePrice: 90,
  operatorDesktopRate: 20,
  operatorMobilRate: 15,
  documenteIncluse: 150,
  documentBands: [
    { upTo: 500, rate: 0.9 },
    { upTo: 1500, rate: 0.35 },
    { upTo: 5000, rate: 0.12 },
    { upTo: null, rate: null },
  ],
  fluxDeeeDelta: 30,
  addons: [
    { key: 'treatment', label: 'Tratări', price: 40 },
    { key: 'pickup', label: 'Programări', price: 30 },
    { key: 'market_prices', label: 'Prețuri pe piață', price: 25 },
    { key: 'nexus', label: 'Nexus', price: 35 },
    { key: 'crm', label: 'CRM', price: 20 },
    { key: 'accounting', label: 'e-Factura', price: 10 },
    { key: 'signature_pad', label: 'Semnătură digitală', price: 10 },
    { key: 'id_scanner', label: 'Scanner buletine', price: 20 },
    { key: 'analytics', label: 'Analytics/BI', price: 15 },
    { key: 'partner_portal', label: 'Portal parteneri', price: 30 },
    { key: 'hr', label: 'Modul HR', price: 30 },
    { key: 'ai_assistant', label: 'VanaGreen AI', price: 25 },
  ],
  bundles: [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment', 'pickup'], price: 55, onboardingPrice: 80 }],
  cantarRate: 50,
  cantarSetupPrice: 50,
  siatdFloorPrice: 65,
  siatdFloorUnits: 40,
  siatdUnitPrice: 1.5,
  lunileAnuale: 10,
  puncteBands: [
    { max: 1, mult: 1.0, label: '1 punct' },
    { max: 3, mult: 1.1, label: '2-3 puncte' },
    { max: 8, mult: 1.25, label: '4-8 puncte' },
    { max: 25, mult: 1.45, label: '9-25 puncte' },
    { max: null, mult: 1.65, label: 'peste 25 puncte' },
  ],
  onboardingBase: 150,
  onboardingOpRate: 15,
  onboardingDeeeDelta: 50,
  onboardingSiatdSetup: 40,
  equipmentItems: [],
}

const BASE_INPUT: PricingCalculateInput = {
  platformId: '00000000-0000-0000-0000-000000000000',
  flux: 'standard',
  opDesktop: 1,
  opMobil: 0,
  puncte: 1,
  documente: 150,
  siatd: 0,
  selectedEquipmentIds: [],
  selectedAddonKeys: [],
  selectedBundleKey: null,
  addonQuantities: {},
  cantare: 0,
}

describe('calculatePrice — default profile (matches HTML default state)', () => {
  it('a firmă sub 3M RON, profil minim (1 op, 1 punct, 150 documente incluse) plătește exact basePrice', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT)
    expect(result.totalMonthly).toBe(90)
    expect(result.totalAnnual).toBe(900) // 90 * 10 luni
    expect(result.onboardingTotal).toBe(150) // onboardingBase * mult(1.0)
    expect(result.manualReviewNeeded).toBe(false)
  })
})

describe('calculatePrice — bandă puncte de lucru (multiplier bază)', () => {
  it('aplică multiplierul benzii corecte (2-3 puncte => ×1.10) la totalul lunar (fără rată separată per punct extra — eliminată 2026-08-05, dubla multiplierul benzii)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, puncte: 2 })
    expect(result.breakdown[0]!.value).toBe(99) // 90 * 1.10 — doar componenta de bază
    expect(result.totalMonthly).toBe(99)
  })

  it('puncte peste toate benzile cade pe ULTIMA bandă (nu aruncă, nu se oprește la a 4-a)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, puncte: 999 })
    expect(result.breakdown[0]!.value).toBe(148.5) // 90 * 1.65
  })

  it('puncte=0 e floor-at 1 (Math.max(1,...)) și cade pe prima bandă', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, puncte: 0 })
    expect(result.totalMonthly).toBe(90)
  })
})

describe('calculatePrice — operatori extra', () => {
  it('operatori desktop extra: primul e inclus, restul se taxează', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, opDesktop: 3 })
    expect(result.totalMonthly).toBe(90 + 2 * 20) // (3-1) extra * 20
  })

  it('operatori mobil: NICIUNUL nu e inclus, toți se taxează', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, opMobil: 2 })
    expect(result.totalMonthly).toBe(90 + 2 * 15)
  })

  it('puncte de lucru: doar multiplierul benzii se aplică (puncte=4 e în banda 4-8, ×1.25), fără rată separată per punct extra', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, puncte: 4 })
    expect(result.totalMonthly).toBe(90 * 1.25)
  })

  it('opDesktop=0 în input e floor-at la 1 (ca în HTML — Math.max(1, ...))', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, opDesktop: 0 })
    expect(result.totalMonthly).toBe(90) // identic cu opDesktop:1, niciun extra
  })
})

describe('calculatePrice — benzi documente (peste cota inclusă)', () => {
  it('documente în prima bandă (151-500)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, documente: 300 })
    // remaining=150, bandSize(500-150)=350, used=150 => 150*0.9=135
    expect(result.totalMonthly).toBe(90 + 135)
    expect(result.manualReviewNeeded).toBe(false)
  })

  it('documente care traversează DOUĂ benzi', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, documente: 700 })
    // banda 1: 350 * 0.9 = 315; banda 2: 200 * 0.35 = 70 => 385
    expect(result.totalMonthly).toBe(90 + 385)
    expect(result.manualReviewNeeded).toBe(false)
  })

  it('documente peste pragul cu rate:null => manualReviewNeeded=true, dar totalMonthly rămâne cifra PARȚIALĂ acumulată (nu ascunsă)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, documente: 6000 })
    // 350*0.9 + 1000*0.35 + 3500*0.12 = 315 + 350 + 420 = 1085
    expect(result.totalMonthly).toBe(90 + 1085)
    expect(result.manualReviewNeeded).toBe(true)
  })

  it('exact la pragul inclus (150) — zero overage', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, documente: 150 })
    expect(result.totalMonthly).toBe(90)
  })

  it('sub pragul inclus — zero overage, nu negativ', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, documente: 10 })
    expect(result.totalMonthly).toBe(90)
  })
})

describe('calculatePrice — flux DEEE/DBA', () => {
  it('adaugă fluxDeeeDelta la total și onboardingDeeeDelta la onboarding', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, flux: 'deee' })
    expect(result.totalMonthly).toBe(90 + 30)
    expect(result.onboardingTotal).toBe(150 + 50)
  })
})

describe('calculatePrice — bundle-uri (preț fix, combinabil cu add-on-uri individuale)', () => {
  it('selectedBundleKey=null — zero impact (backward-compatible)', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT)
    expect(result.totalMonthly).toBe(90)
  })

  it('bundle selectat — adaugă prețul FIX al pachetului (nu suma add-on-urilor incluse)', () => {
    // CONFIG.bundles[0] = 'starter': treatment(40) + pickup(30) la preț fix 55, nu 70.
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedBundleKey: 'starter' })
    expect(result.totalMonthly).toBe(90 + 55)
  })

  it('add-on-urile incluse în bundle NU se taxează a doua oară dacă sunt și în selectedAddonKeys', () => {
    const result = calculatePrice(CONFIG, {
      ...BASE_INPUT,
      selectedBundleKey: 'starter',
      selectedAddonKeys: ['treatment', 'pickup'],
    })
    expect(result.totalMonthly).toBe(90 + 55) // NU 90 + 55 + 40 + 30
  })

  it('bundle + add-on individual din AFARA pachetului — se adună', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedBundleKey: 'starter', selectedAddonKeys: ['crm'] })
    expect(result.totalMonthly).toBe(90 + 55 + 20)
  })

  it('key de bundle necunoscut e ignorat silențios (nu aruncă, nu adaugă cost)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedBundleKey: 'does_not_exist' })
    expect(result.totalMonthly).toBe(90)
  })

  it('bundle selectat — onboardingPrice fix ÎNLOCUIEȘTE complet formula normală de onboarding (nu se adună)', () => {
    // Formula normală ar da 150 (onboardingBase*mult 1.0) — bundle-ul o înlocuiește cu 80.
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedBundleKey: 'starter', opDesktop: 3, flux: 'deee', siatd: 50 })
    expect(result.onboardingTotal).toBe(80)
  })

  it('fără bundle — onboarding rămâne formula normală (backward-compatible)', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT)
    expect(result.onboardingTotal).toBe(150)
  })

  it('bundle necunoscut — onboarding rămâne formula normală (nu se aplică override)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedBundleKey: 'does_not_exist' })
    expect(result.onboardingTotal).toBe(150)
  })
})

describe('calculatePrice — preset-uri bundle (puncteLucru/operatoriDesktop/operatoriMobil/documente)', () => {
  it('câmpurile de preset NU afectează calculul — doar UI-ul (CalculatorTab) le citește la selectare', () => {
    // CONFIG.bundles[0] nu are preset-uri setate (opționale, absente) — calc.ts nici nu le atinge.
    const withBundle = calculatePrice(CONFIG, { ...BASE_INPUT, selectedBundleKey: 'starter' })
    const withoutBundle = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['treatment', 'pickup'] })
    // Diferența e doar bundleTotal(55) vs suma addon-urilor(40+30=70) — preset-urile nu intră în joc.
    expect(withBundle.totalMonthly).toBe(90 + 55)
    expect(withoutBundle.totalMonthly).toBe(90 + 70)
  })
})

describe('calculatePrice — add-on-uri (catalog generic, sumat pe selectedAddonKeys)', () => {
  it('toate add-on-urile bifate se însumează', () => {
    const result = calculatePrice(CONFIG, {
      ...BASE_INPUT,
      selectedAddonKeys: ['treatment', 'pickup', 'market_prices', 'nexus', 'crm'],
    })
    expect(result.totalMonthly).toBe(90 + 40 + 30 + 25 + 35 + 20)
  })

  it('selectedAddonKeys=[] — zero impact (backward-compatible)', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT)
    expect(result.totalMonthly).toBe(90)
  })

  it('market_prices — adaugă prețul lui, alături de restul add-on-urilor', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['market_prices', 'treatment'] })
    expect(result.totalMonthly).toBe(90 + 25 + 40)
  })

  it('nexus — adaugă prețul lui la total', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['nexus'] })
    expect(result.totalMonthly).toBe(90 + 35)
  })

  it('crm — adaugă prețul lui la total', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['crm'] })
    expect(result.totalMonthly).toBe(90 + 20)
  })

  it('accounting (e-Factura) — adaugă prețul FIX la total (nu % din bază)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['accounting'] })
    expect(result.totalMonthly).toBe(90 + 10)
  })

  it('signature_pad — adaugă prețul lui la total, NU la onboarding (F16-software)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['signature_pad'] })
    expect(result.totalMonthly).toBe(90 + 10)
    expect(result.onboardingTotal).toBe(150)
  })

  it('id_scanner — adaugă prețul lui la total, NU la onboarding', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['id_scanner'] })
    expect(result.totalMonthly).toBe(90 + 20)
    expect(result.onboardingTotal).toBe(150)
  })

  it('analytics — adaugă prețul lui la total, NU la onboarding (F6)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['analytics'] })
    expect(result.totalMonthly).toBe(90 + 15)
    expect(result.onboardingTotal).toBe(150)
  })

  it('partner_portal — adaugă prețul lui la total, NU la onboarding (F5)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['partner_portal'] })
    expect(result.totalMonthly).toBe(90 + 30)
    expect(result.onboardingTotal).toBe(150)
  })

  it('hr — adaugă prețul lui la total, NU la onboarding (F14)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['hr'] })
    expect(result.totalMonthly).toBe(90 + 30)
    expect(result.onboardingTotal).toBe(150)
  })

  it('ai_assistant — adaugă prețul lui la total, NU la onboarding (F13)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['ai_assistant'] })
    expect(result.totalMonthly).toBe(90 + 25)
    expect(result.onboardingTotal).toBe(150)
  })

  it('key necunoscut în selectedAddonKeys e ignorat silențios (nu aruncă, nu adaugă cost)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, selectedAddonKeys: ['does_not_exist'] })
    expect(result.totalMonthly).toBe(90)
  })
})

describe('calculatePrice — cântare smart (preț per cântar conectat)', () => {
  it('cantare=0 => zero cost (default)', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT)
    expect(result.totalMonthly).toBe(90)
  })

  it('cantare>0 => cantare × cantarRate, adăugat la total lunar', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, cantare: 3 })
    expect(result.totalMonthly).toBe(90 + 3 * 50)
  })

  it('cantare>0 => taxă de configurare one-time (cantarSetupPrice), o singură dată indiferent de numărul de cântare (2026-08-19)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, cantare: 3 })
    expect(result.onboardingTotal).toBe(150 + 50)
  })

  it('cantare=0 => zero taxă de configurare', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT)
    expect(result.onboardingTotal).toBe(150)
  })
})

describe('calculatePrice — Robot SIATD', () => {
  it('siatd=0 => zero cost (nu se activează robotul)', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, siatd: 0 })
    expect(result.totalMonthly).toBe(90)
    expect(result.onboardingTotal).toBe(150) // fără onboardingSiatdSetup
  })

  it('siatd sub floorUnits => doar floorPrice, fără cost per unitate', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, siatd: 10 })
    expect(result.totalMonthly).toBe(90 + 65) // floorPrice, fără extra (10 < 40)
    expect(result.onboardingTotal).toBe(150 + 40) // + onboardingSiatdSetup, robotul e activ
  })

  it('siatd peste floorUnits => floorPrice + (siatd - floorUnits) * unitPrice', () => {
    const result = calculatePrice(CONFIG, { ...BASE_INPUT, siatd: 50 })
    expect(result.totalMonthly).toBe(90 + 65 + 10 * 1.5) // 65 + (50-40)*1.5 = 80
  })
})

describe('calculatePrice — onboarding (taxă de inițiere, one-time)', () => {
  it('crește cu operatori extra, flux DEEE, și setup SIATD, scalat de multiplierul benzii de puncte (fără rată separată per punct — eliminată 2026-08-05, dubla multiplierul benzii)', () => {
    const result = calculatePrice(CONFIG, {
      ...BASE_INPUT,
      opDesktop: 3,
      puncte: 2, // banda 2-3 puncte => mult 1.10, scalează onboardingBase
      flux: 'deee',
      siatd: 20,
    })
    // 150*1.10 + (3-1)*15 + 50 + 40 = 165 + 30 + 50 + 40 = 285
    expect(result.onboardingTotal).toBe(285)
  })
})

describe('calculatePrice — breakdown', () => {
  it('conține o linie pt. fiecare componentă de preț, cu label + value numeric', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT)
    expect(result.breakdown.length).toBeGreaterThan(0)
    for (const row of result.breakdown) {
      expect(typeof row.label).toBe('string')
      expect(typeof row.value).toBe('number')
    }
  })
})

describe('calculatePrice — Sprint 4: echipamente fizice', () => {
  const CONFIG_WITH_EQUIPMENT: PricingConfig = {
    ...CONFIG,
    equipmentItems: [
      { id: '11111111-1111-1111-1111-111111111111', name: 'Signature pad STU-430', purchasePrice: 800, integrationPrice: 200, monthlyFee: 15 },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Scanner ID QS2000', purchasePrice: 1200, integrationPrice: 300, monthlyFee: 25 },
    ],
  }

  it('fără echipamente selectate — zero impact pe total (backward-compatible)', () => {
    const result = calculatePrice(CONFIG_WITH_EQUIPMENT, BASE_INPUT)
    expect(result.totalMonthly).toBe(90)
    expect(result.onboardingTotal).toBe(150)
  })

  it('un echipament selectat — abonament lunar intră în totalMonthly, achiziție+integrare în onboarding', () => {
    const result = calculatePrice(CONFIG_WITH_EQUIPMENT, {
      ...BASE_INPUT,
      selectedEquipmentIds: ['11111111-1111-1111-1111-111111111111'],
    })
    expect(result.totalMonthly).toBe(90 + 15) // basePrice + monthlyFee
    expect(result.onboardingTotal).toBe(150 + 800 + 200) // onboardingBase*mult + purchase + integration
  })

  it('mai multe echipamente selectate — toate se însumează', () => {
    const result = calculatePrice(CONFIG_WITH_EQUIPMENT, {
      ...BASE_INPUT,
      selectedEquipmentIds: [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
    })
    expect(result.totalMonthly).toBe(90 + 15 + 25)
    expect(result.onboardingTotal).toBe(150 + 800 + 200 + 1200 + 300)
  })

  it('id necunoscut în selectedEquipmentIds e ignorat silențios (nu aruncă, nu adaugă cost)', () => {
    const result = calculatePrice(CONFIG_WITH_EQUIPMENT, {
      ...BASE_INPUT,
      selectedEquipmentIds: ['99999999-9999-9999-9999-999999999999'],
    })
    expect(result.totalMonthly).toBe(90)
  })
})

describe('calculatePrice — planName pe bandă de puncte de lucru', () => {
  const CONFIG_WITH_PLANS: PricingConfig = {
    ...CONFIG,
    puncteBands: [
      { max: 1, mult: 1.0, label: '1 punct', planName: 'Start' },
      { max: 3, mult: 2.0, label: '2-3 puncte', planName: 'Business' },
      { max: 8, mult: 3.0, label: '4-8 puncte', planName: 'Pro' },
      { max: 25, mult: 5.0, label: '9-25 puncte', planName: 'Enterprise' },
      { max: null, mult: 7.0, label: 'peste 25 puncte', planName: 'Enterprise+' },
    ],
  }

  it('întoarce numele planului corespunzător benzii de puncte în care se încadrează clientul', () => {
    expect(calculatePrice(CONFIG_WITH_PLANS, { ...BASE_INPUT, puncte: 1 }).planName).toBe('Start')
    expect(calculatePrice(CONFIG_WITH_PLANS, { ...BASE_INPUT, puncte: 2 }).planName).toBe('Business')
    expect(calculatePrice(CONFIG_WITH_PLANS, { ...BASE_INPUT, puncte: 5 }).planName).toBe('Pro')
    expect(calculatePrice(CONFIG_WITH_PLANS, { ...BASE_INPUT, puncte: 15 }).planName).toBe('Enterprise')
    expect(calculatePrice(CONFIG_WITH_PLANS, { ...BASE_INPUT, puncte: 100 }).planName).toBe('Enterprise+')
  })

  it('întoarce null dacă banda nu are planName configurat (config-uri vechi, câmp opțional)', () => {
    const result = calculatePrice(CONFIG, BASE_INPUT) // CONFIG original, fără planName pe benzi
    expect(result.planName).toBeNull()
  })
})

describe('calculatePrice — benzi pe cantitate pt. add-on-uri (sprint de-hardcodare 2026-08-25)', () => {
  const CONFIG_WITH_BANDS: PricingConfig = {
    ...CONFIG,
    addons: [
      // hr pe angajați: 1-9 → 3 RON/angajat, 10-49 → 2.5, restul (null) → 2
      { key: 'hr', label: 'HR', price: 30, bands: [{ upTo: 9, unitPrice: 3 }, { upTo: 49, unitPrice: 2.5 }, { upTo: null, unitPrice: 2 }] },
      // ai_assistant fără benzi — preț fix, cantitatea ignorată
      { key: 'ai_assistant', label: 'VanaGreen AI', price: 25 },
    ],
  }

  it('cantitatea cade într-o singură treaptă și se înmulțește cu unitPrice-ul ei', () => {
    const result = calculatePrice(CONFIG_WITH_BANDS, {
      ...BASE_INPUT,
      selectedAddonKeys: ['hr'],
      addonQuantities: { hr: 15 },
    })
    // baza 90 + 15 × 2.5 = 127.5
    expect(result.totalMonthly).toBe(127.5)
    expect(result.breakdown).toContainEqual({ label: 'Add-on: HR (15 × 2.5)', value: 37.5 })
  })

  it('fără cantitate trimisă = 1 (compatibil cu clienți vechi și self-serve neschimbat)', () => {
    const result = calculatePrice(CONFIG_WITH_BANDS, { ...BASE_INPUT, selectedAddonKeys: ['ai_assistant'] })
    expect(result.totalMonthly).toBe(90 + 25)
  })

  it('add-on fără benzi ignoră orice cantitate trimisă', () => {
    const result = calculatePrice(CONFIG_WITH_BANDS, {
      ...BASE_INPUT,
      selectedAddonKeys: ['ai_assistant'],
      addonQuantities: { ai_assistant: 7 },
    })
    expect(result.totalMonthly).toBe(90 + 25)
  })

  it('ultima bandă cu upTo=null acoperă cantități nelimitate', () => {
    const result = calculatePrice(CONFIG_WITH_BANDS, {
      ...BASE_INPUT,
      selectedAddonKeys: ['hr'],
      addonQuantities: { hr: 500 },
    })
    expect(result.totalMonthly).toBe(90 + 500 * 2)
  })
})
