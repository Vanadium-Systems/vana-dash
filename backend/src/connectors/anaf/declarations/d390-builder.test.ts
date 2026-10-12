import { describe, expect, it } from 'vitest'
import { buildD390Xml } from './d390-builder.js'
import type { CompanyIdentity, Declarant, DeclarationLine } from './types.js'

const company: CompanyIdentity = {
  cif: '12345674',
  name: 'Acme Recycling SRL',
  address: 'Str. Exemplu 1, Bucuresti',
  bank: 'Revolut Bank',
  iban: 'RO49AAAA1B31007593840000',
  vatIntraCommunityCode: 'RO90000014',
}

const declarant: Declarant = { firstName: 'Stefan', lastName: 'Popescu', role: 'Administrator' }

const euLine: DeclarationLine = {
  reverseChargeType: 'eu_services',
  documentNumber: 'HTZ-001',
  issuedAt: new Date('2026-07-10T00:00:00Z'),
  amountForeign: 100,
  currency: 'EUR',
  fxRate: 5,
  baseRon: 500,
  vatRon: 105,
  counterpartyCountry: 'DE',
  counterpartyVatId: '123456789',
  counterpartyName: 'Hetzner Online GmbH',
}

const nonEuLine: DeclarationLine = {
  reverseChargeType: 'non_eu_services',
  documentNumber: 'CF-001',
  issuedAt: new Date('2026-07-15T00:00:00Z'),
  amountForeign: 50,
  currency: 'USD',
  fxRate: 4.6,
  baseRon: 230,
  vatRon: 48.3,
  counterpartyCountry: 'US',
  counterpartyVatId: null,
  counterpartyName: 'Cloudflare Inc',
}

describe('buildD390Xml', () => {
  it('excludes non_eu_services lines entirely — never appear in D390', () => {
    const { xml } = buildD390Xml('2026-07', [euLine, nonEuLine], company, declarant)
    expect(xml).not.toContain('Cloudflare')
    expect(xml).not.toContain('<tara>US</tara>')
  })

  it('emits eu_services lines as tip=S with country/vat-id/base', () => {
    const { xml, totalBaseRon } = buildD390Xml('2026-07', [euLine, nonEuLine], company, declarant)
    expect(xml).toContain('<tip>S</tip>')
    expect(xml).toContain('<tara>DE</tara>')
    expect(xml).toContain('<codO>123456789</codO>')
    expect(xml).toContain('<denO>Hetzner Online GmbH</denO>')
    expect(xml).toContain('<baza>500.00</baza>')
    expect(totalBaseRon).toBe(500)
  })

  it('strips the RO prefix from the VAT intra-community code for <cui>', () => {
    const { xml } = buildD390Xml('2026-07', [euLine], company, declarant)
    expect(xml).toContain('<cui>90000014</cui>')
  })

  it('produces a valid empty declaration with zero eu_services lines', () => {
    const { xml, totalBaseRon } = buildD390Xml('2026-07', [nonEuLine], company, declarant)
    expect(xml).not.toContain('<operatie>')
    expect(xml).toContain('<nrOPI>0</nrOPI>')
    expect(totalBaseRon).toBe(0)
  })
})
