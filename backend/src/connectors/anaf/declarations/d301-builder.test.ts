import { describe, expect, it } from 'vitest'
import { buildD301 } from './d301-builder.js'
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

describe('buildD301', () => {
  it('puts every line in section 4 and repeats the EU ones in section 4.1', () => {
    const { xml } = buildD301('2026-07', [euLine, nonEuLine], company, declarant)
    expect(xml.match(/tip_operatie="4"/g)).toHaveLength(2)
    expect(xml.match(/tip_operatie="5"/g)).toHaveLength(1)
    expect(xml).toContain('tip_operatie="5" nr_doc="HTZ-001"')
  })

  it('totals section 4 over all lines and 4.1 over the EU ones, control sum over both', () => {
    const { xml, totals } = buildD301('2026-07', [euLine, nonEuLine], company, declarant)
    expect(xml).toContain('baza4="730.00" tva4="153.30" baza5="500.00" tva5="105.00"')
    // INT(730 + 153.30 + 500 + 105)
    expect(xml).toContain('totalPlata_A="1488"')
    expect(totals).toEqual({ baseRon: 730, vatRon: 153.3 })
  })

  it('writes attributes on the v1 namespace, month without a leading zero', () => {
    const { xml } = buildD301('2026-07', [euLine], company, declarant)
    expect(xml).toContain('xmlns="mfp:anaf:dgti:d301:declaratie:v1"')
    expect(xml).toContain('an="2026" luna="7" mijl_trans="0" temei="0"')
    expect(xml).toContain('data_doc="10.07.2026"')
  })

  it('sets pers_inreg=2 when the intra-community VAT code is configured, 1 otherwise', () => {
    expect(buildD301('2026-07', [euLine], company, declarant).xml).toContain('pers_inreg="2"')
    const withoutCode = buildD301('2026-07', [nonEuLine], { ...company, vatIntraCommunityCode: '' }, declarant)
    expect(withoutCode.xml).toContain('pers_inreg="1"')
  })

  it('fills the form tables 4 and 4.1 in the datasets packet', () => {
    const { datasets } = buildD301('2026-07', [euLine, nonEuLine], company, declarant)
    expect(datasets).toContain('<baza41>730.00</baza41>')
    expect(datasets).toContain('<baza42>500.00</baza42>')
    expect(datasets.match(/<rx4>/g)).toHaveLength(2)
    expect(datasets.match(/<rx5>/g)).toHaveLength(1)
    expect(datasets).toContain('<DATA_DOCUMENT>10/07/2026</DATA_DOCUMENT>')
  })

  it('escapes XML special characters in free-text fields', () => {
    const { xml, datasets } = buildD301('2026-07', [], { ...company, address: 'Str. "A" & B' }, declarant)
    expect(xml).toContain('Str. &quot;A&quot; &amp; B')
    expect(datasets).toContain('Str. &quot;A&quot; &amp; B')
  })

  it('emits zero totals for a month with no lines', () => {
    const { xml, totals } = buildD301('2026-07', [], company, declarant)
    expect(xml).toContain('baza4="0.00"')
    expect(xml).not.toContain('<sectiune')
    expect(totals).toEqual({ baseRon: 0, vatRon: 0 })
  })
})
