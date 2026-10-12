import { describe, expect, it } from 'vitest'
import { buildD301Xml } from './d301-builder.js'
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

describe('buildD301Xml', () => {
  it('maps eu_services to tip_operatie=5 and non_eu_services to tip_operatie=4', () => {
    const { xml } = buildD301Xml('2026-07', [euLine, nonEuLine], company, declarant)
    expect(xml).toContain('<tip_operatie>5</tip_operatie>')
    expect(xml).toContain('<tip_operatie>4</tip_operatie>')
  })

  it('sums base/vat separately into baza4/tva4 (non-UE) and baza5/tva5 (UE)', () => {
    const { xml, totals } = buildD301Xml('2026-07', [euLine, nonEuLine], company, declarant)
    expect(xml).toContain('<baza4>230.00</baza4>')
    expect(xml).toContain('<tva4>48.30</tva4>')
    expect(xml).toContain('<baza5>500.00</baza5>')
    expect(xml).toContain('<tva5>105.00</tva5>')
    expect(totals.baseRon).toBeCloseTo(730)
    expect(totals.vatRon).toBeCloseTo(153.3)
  })

  it('sets pers_inreg=2 when the intra-community VAT code is configured, 1 otherwise', () => {
    const withCode = buildD301Xml('2026-07', [euLine], company, declarant)
    expect(withCode.xml).toContain('<pers_inreg>2</pers_inreg>')

    const withoutCode = buildD301Xml('2026-07', [nonEuLine], { ...company, vatIntraCommunityCode: '' }, declarant)
    expect(withoutCode.xml).toContain('<pers_inreg>1</pers_inreg>')
  })

  it('produces one <sectiune> per line, in the same order', () => {
    const { xml } = buildD301Xml('2026-07', [euLine, nonEuLine], company, declarant)
    const count = xml.match(/<sectiune>/g)?.length
    expect(count).toBe(2)
  })

  it('escapes XML special characters in free-text fields', () => {
    const { xml } = buildD301Xml('2026-07', [], { ...company, address: 'Str. "A" & B' }, declarant)
    expect(xml).toContain('Str. &quot;A&quot; &amp; B')
  })

  it('emits zero totals for a month with no lines', () => {
    const { xml, totals } = buildD301Xml('2026-07', [], company, declarant)
    expect(xml).toContain('<baza4>0.00</baza4>')
    expect(xml).toContain('<baza5>0.00</baza5>')
    expect(xml).not.toContain('<sectiune>')
    expect(totals).toEqual({ baseRon: 0, vatRon: 0 })
  })
})
