import { describe, expect, it } from 'vitest'
import type { PricingCalculateInput, PricingConfig } from '@/shared/lib/types'
import { calculatePrice as calculatePriceBackend } from '../../../../backend/src/modules/pricing/calc'
import { calculatePrice as calculatePriceFrontend } from './calc'

// Gardă contra drift între mirror-uri (frontend/backend) — vezi comentariul din calc.ts.
// Dacă acest test pică după o modificare la unul din cele două fișiere, cealaltă copie
// trebuie actualizată identic.

const config: PricingConfig = {
  basePrice: 100,
  operatorDesktopRate: 20,
  operatorMobilRate: 10,
  documenteIncluse: 100,
  documentBands: [
    { upTo: 500, rate: 0.5 },
    { upTo: 2000, rate: 0.3 },
    { upTo: null, rate: null },
  ],
  fluxDeeeDelta: 50,
  addons: [
    { key: 'treatment', label: 'Tratări', price: 30 },
    { key: 'pickup', label: 'Programări', price: 25 },
    { key: 'market_prices', label: 'Prețuri pe piață', price: 20 },
    { key: 'nexus', label: 'Nexus', price: 40 },
    { key: 'crm', label: 'CRM', price: 18 },
    { key: 'accounting', label: 'e-Factura', price: 12 },
    { key: 'signature_pad', label: 'Semnătură digitală', price: 10 },
    { key: 'id_scanner', label: 'Scanner buletine', price: 20 },
    { key: 'analytics', label: 'Analytics/BI', price: 15 },
    { key: 'partner_portal', label: 'Portal parteneri', price: 30 },
    { key: 'hr', label: 'Modul HR', price: 30 },
    { key: 'ai_assistant', label: 'VanaGreen AI', price: 25 },
  ],
  bundles: [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment', 'pickup'], discountPercent: 15, onboardingHours: 8 }],
  cantarRate: 50,
  siatdFloorPrice: 100,
  siatdFloorUnits: 50,
  siatdUnitPrice: 1.5,
  lunileAnuale: 11,
  puncteBands: [
    { max: 2, mult: 1, label: '1-2 puncte' },
    { max: 6, mult: 1.5, label: '3-6 puncte' },
    { max: null, mult: 2, label: 'peste 6 puncte' },
  ],
  onboardingHourlyRate: 40,
  onboardingDefaultHours: 5,
  onboardingMarginPercent: 20,
  discountPercent: 0,
  equipmentItems: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Signature pad', purchasePrice: 800, integrationPrice: 200, monthlyFee: 15 },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Scanner ID', purchasePrice: 1200, integrationPrice: 300, monthlyFee: 25 },
  ],
}

const baseInput: Omit<PricingCalculateInput, 'platformId'> = {
  flux: 'standard',
  opDesktop: 1,
  opMobil: 0,
  puncte: 1,
  documente: 0,
  siatd: 0,
  selectedEquipmentIds: [],
  selectedAddonKeys: [],
  selectedBundleKey: null,
  cantare: 0,
  onboardingHours: null,
  onboardingMarginPercent: null,
}

const cases: Array<Partial<typeof baseInput>> = [
  {},
  { puncte: 2 },
  { opDesktop: 3, opMobil: 2, puncte: 4 },
  { puncte: 10, documente: 5000, flux: 'deee' },
  { documente: 300, selectedAddonKeys: ['treatment', 'pickup', 'nexus'] },
  { selectedAddonKeys: ['market_prices'] },
  { selectedAddonKeys: ['market_prices', 'treatment'], puncte: 3 },
  { siatd: 120 },
  { opDesktop: 0, puncte: 0, documente: 0 },
  { selectedEquipmentIds: ['11111111-1111-1111-1111-111111111111'] },
  { selectedEquipmentIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'] },
  { selectedAddonKeys: ['crm'] },
  { selectedAddonKeys: ['crm', 'treatment'], selectedEquipmentIds: ['22222222-2222-2222-2222-222222222222'], puncte: 3 },
  { selectedAddonKeys: ['accounting'] },
  { selectedAddonKeys: ['accounting', 'nexus', 'crm'] },
  { selectedAddonKeys: ['signature_pad', 'id_scanner'] },
  { cantare: 3 },
  { cantare: 2, selectedAddonKeys: ['signature_pad'], puncte: 3 },
  { selectedAddonKeys: ['analytics'] },
  { selectedAddonKeys: ['partner_portal'] },
  { selectedAddonKeys: ['analytics', 'partner_portal'], cantare: 1, puncte: 4 },
  { selectedAddonKeys: ['hr'] },
  { selectedAddonKeys: ['ai_assistant'] },
  { selectedAddonKeys: ['hr', 'ai_assistant', 'analytics'], cantare: 1, puncte: 4 },
  { selectedBundleKey: 'starter' },
  { selectedBundleKey: 'starter', selectedAddonKeys: ['treatment', 'pickup'] },
  { selectedBundleKey: 'starter', selectedAddonKeys: ['crm'], puncte: 3 },
  { selectedBundleKey: 'does_not_exist' },
  { onboardingHours: 20 },
  { onboardingHours: 20, onboardingMarginPercent: 25, selectedBundleKey: 'starter' },
  { onboardingHours: 0 },
]

describe('calculatePrice — paritate frontend/backend', () => {
  it.each(cases)('produce rezultate identice pentru input %#', (partial) => {
    const input: PricingCalculateInput = { platformId: 'test-platform', ...baseInput, ...partial }
    const feResult = calculatePriceFrontend(config, input)
    // backend-ul primește input post-Zod: addonQuantities mereu prezent prin .default({})
    const beResult = calculatePriceBackend(config, { ...input, addonQuantities: input.addonQuantities ?? {} })
    expect(feResult).toEqual(beResult)
  })
})

describe('calculatePrice — paritate cu reducere de campanie', () => {
  it.each(cases)('produce rezultate identice pentru input %#', (partial) => {
    const discounted = { ...config, discountPercent: 15 }
    const input: PricingCalculateInput = { platformId: 'test-platform', ...baseInput, ...partial }
    expect(calculatePriceFrontend(discounted, input)).toEqual(
      calculatePriceBackend(discounted, { ...input, addonQuantities: input.addonQuantities ?? {} }),
    )
  })
})
