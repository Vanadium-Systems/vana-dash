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
  // operator desktop, 1 punct) — bundleTotal (56) e doar prețul modulelor; totalul real include și
  // basePrice (90) — exact bug-ul semnalat de Stefan (2026-09-21): rândul din Pachete NU
  // trebuie să arate 56, ci basePrice + bundleTotal.
  bundles: [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment', 'pickup'], discountPercent: 20, onboardingHours: 8 }],
  cantarRate: 50,
  siatdFloorPrice: 65,
  siatdFloorUnits: 40,
  siatdUnitPrice: 1.5,
  lunileAnuale: 10,
  puncteBands: [{ max: null, mult: 1.0, label: '1 punct' }],
  onboardingHourlyRate: 30,
  onboardingDefaultHours: 5,
  onboardingMarginPercent: 0,
  discountPercent: 0,
  equipmentItems: [],
}

describe('renderPriceSheetHtml', () => {
  it('arată tariful TOTAL calculat pt. pachet, nu doar prețul modulelor din pachet', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    // basePrice(90) × mult(1.0) + bundleTotal(70 − 20% = 56) = 146
    expect(html).toContain('146 EUR/lună')
    expect(html).not.toMatch(/>56 EUR\/lună</)
  })

  it('taxa de inițiere a pachetului vine din orele lui (8 h × 30)', () => {
    const html = renderPriceSheetHtml(CONFIG, 'VanaGreen')
    expect(html).toContain('240 EUR')
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
