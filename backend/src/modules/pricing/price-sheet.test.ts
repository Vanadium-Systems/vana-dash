/**
 * modules/pricing/price-sheet.ts — un-pager HTML (randat apoi în PDF de routes.ts, netestat
 * aici — vezi contract-templates.test.ts pt. pattern-ul de randare directă). Pure function pe
 * un PricingConfig în memorie.
 */
import { describe, expect, it } from 'vitest'
import { renderPriceSheetHtml } from './price-sheet.js'
import type { PricingConfig } from './schema.js'

const CONFIG: PricingConfig = {
  basePrice: 90,
  operatorDesktopRate: 20,
  operatorMobilRate: 15,
  documenteIncluse: 150,
  documentBands: [{ upTo: null, rate: null }],
  fluxDeeeDelta: 30,
  addons: [
    { key: 'treatment', label: 'Tratări', price: 40 },
    { key: 'pickup', label: 'Programări', price: 30 },
  ],
  // bundle FĂRĂ operatori/puncte presetate (folosesc default-urile din bundleMonthlyInput: 1
  // operator desktop, 1 punct) — bundleTotal (55) e doar suprataxa; totalul real include și
  // basePrice (90) — exact bug-ul semnalat de Stefan (2026-09-21): rândul din Pachete NU
  // trebuie să arate 55, ci basePrice + bundleTotal.
  bundles: [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment', 'pickup'], price: 55, onboardingPrice: 80 }],
  cantarRate: 50,
  cantarSetupPrice: 50,
  siatdFloorPrice: 65,
  siatdFloorUnits: 40,
  siatdUnitPrice: 1.5,
  lunileAnuale: 10,
  puncteBands: [{ max: null, mult: 1.0, label: '1 punct' }],
  onboardingBase: 150,
  onboardingOpRate: 15,
  onboardingDeeeDelta: 50,
  onboardingSiatdSetup: 40,
  equipmentItems: [],
}

describe('renderPriceSheetHtml', () => {
  it('arată tariful TOTAL calculat pt. pachet, nu doar suprataxa fixă (bundle.price)', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    // basePrice(90) × mult(1.0) + bundleTotal(55) = 145 — NU 55 (bundle.price brut)
    expect(html).toContain('145 EUR/lună')
    expect(html).not.toMatch(/>55 EUR\/lună</)
  })

  it('taxa de inițiere a pachetului rămâne bundle.onboardingPrice (deja corect prin calc.ts)', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    expect(html).toContain('80 EUR')
  })

  it('include rândul "Personalizat" cu notă de configurare manuală', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    expect(html).toContain('Personalizat')
    expect(html).toContain('configurat manual')
  })

  it('modulele apar fără preț (doar nume, secțiune separată de Pachete)', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    const modulesSection = html.split('Module disponibile')[1]!
    expect(modulesSection).toContain('Tratări')
    expect(modulesSection).toContain('Programări')
    expect(modulesSection).not.toMatch(/40 EUR|30 EUR/)
  })

  it('listează dimensiunile configurabile (regression: Stefan a semnalat lipsa lor)', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    expect(html).toContain('Cântare smart conectate')
    expect(html).toContain('Robot SIATD')
    expect(html).toContain('Documente/lună')
    expect(html).toContain('Puncte de lucru')
    expect(html).toContain('Operatori desktop')
    expect(html).toContain('Operatori mobil')
  })

  it('omite Echipamente din listă când config-ul nu are niciunul', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    expect(html).not.toContain('Echipamente fizice')
  })

  it('include Echipamente când config-ul are cel puțin unul', () => {
    const withEquipment: PricingConfig = {
      ...CONFIG,
      equipmentItems: [
        { id: '00000000-0000-0000-0000-000000000001', name: 'Cântar auto', purchasePrice: 500, integrationPrice: 200, monthlyFee: 10 },
      ],
    }
    const html = renderPriceSheetHtml(withEquipment, 'VanaGreen')
    expect(html).toContain('Echipamente fizice')
  })

  it('HTML-escapes numele platformei', () => {
    const html = renderPriceSheetHtml(CONFIG, '<script>alert(1)</script>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('arată operatori/puncte/documente per pachet (regression: Stefan a cerut coloana lipsă)', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    expect(html).toContain('1 desktop, 0 mobil, 1 puncte, 150 doc/lună')
  })

  it('nu conține liniuța lungă (—) în output (regula "SEMNE AI DE EVITAT" din CLAUDE.md)', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    // singura excepție tolerată: placeholder-ul de "N/A" pt. o celulă goală, identic cu
    // convenția din restul aplicației (ex. ClientsTab „—" pt. câmp nemapat).
    const withoutNaPlaceholders = html.replace(/>—</g, '><')
    expect(withoutNaPlaceholders).not.toContain('—')
  })
})
