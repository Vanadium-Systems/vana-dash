import { describe, expect, it } from 'vitest'
import { buildD390 } from './d390-builder.js'
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
  recordId: '00000000-0000-0000-0000-000000000001',
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
  recordId: '00000000-0000-0000-0000-000000000002',
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

describe('buildD390', () => {
  it('excludes non_eu_services lines entirely', () => {
    const { xml } = buildD390('2026-07', [euLine, nonEuLine], company, declarant)
    expect(xml).not.toContain('CLOUDFLARE')
    expect(xml).not.toContain('tara="US"')
  })

  it('emits one operatie per partner in whole lei, summing that partner\'s invoices', () => {
    const second = { ...euLine, documentNumber: 'HTZ-002', baseRon: 98.07, counterpartyVatId: 'DE123456789' }
    const { xml, partners, totalBaseRon } = buildD390('2026-07', [euLine, second, nonEuLine], company, declarant)
    expect(partners).toHaveLength(1)
    expect(xml).toContain('<operatie tip="S" tara="DE" codO="123456789" denO="HETZNER ONLINE GMBH" baza="598" />')
    expect(totalBaseRon).toBe(598)
  })

  it('control sum is the number of partners plus the bases', () => {
    const { xml } = buildD390('2026-07', [euLine], company, declarant)
    expect(xml).toContain('totalPlata_A="501"')
    expect(xml).toContain('nrOPI="1" bazaL="0" bazaT="0" bazaA="0" bazaP="0" bazaS="500" bazaR="0" total_baza="500"')
  })

  it('writes the v3 namespace, the month as the form saves it and the CUI without RO', () => {
    const { xml } = buildD390('2026-07', [euLine], company, declarant)
    expect(xml).toContain('xmlns="mfp:anaf:dgti:d390:declaratie:v3"')
    expect(xml).toContain('luna="7" an="2026"')
    expect(xml).toContain('cui="90000014"')
  })

  it('fills one OP2 row per partner in the datasets packet', () => {
    const { datasets } = buildD390('2026-07', [euLine], company, declarant)
    expect(datasets).toContain('<OP2><seq>1</seq><TIP_OP>S</TIP_OP><TARA>DE</TARA><COD_OP>123456789</COD_OP>')
    expect(datasets).toContain('<SUMA_S>500</SUMA_S>')
    expect(datasets).toContain('<luna_r>7</luna_r>')
  })

  it('writes names and addresses in plain capitals', () => {
    const { xml } = buildD390('2026-07', [euLine], { ...company, address: 'Str. Școlii 1, Brașov' }, declarant)
    expect(xml).toContain('adresa="STR. SCOLII 1, BRASOV"')
    expect(xml).toContain('den="ACME RECYCLING SRL"')
    expect(xml).toContain('prenume_declar="STEFAN"')
  })

  it('produces an empty declaration with zero eu_services lines', () => {
    const { xml, totalBaseRon } = buildD390('2026-07', [nonEuLine], company, declarant)
    expect(xml).not.toContain('<operatie')
    expect(xml).toContain('nrOPI="0"')
    expect(totalBaseRon).toBe(0)
  })
})
