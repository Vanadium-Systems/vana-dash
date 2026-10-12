import { describe, expect, it } from 'vitest'
import { buildInvoiceXml, computeTotals } from './xml-builder.js'
import type { UblInvoiceInput } from './types.js'

const input: UblInvoiceInput = {
  documentNumber: 'VAN-2026-0001',
  issuedAt: new Date('2026-07-04T10:00:00Z'),
  dueAt: new Date('2026-08-03T10:00:00Z'),
  currency: 'RON',
  supplier: {
    name: 'Vanadium Systems SRL',
    cif: '11111111',
    regCom: 'J40/1234/2025',
    address: 'Str. Exemplu 1',
    city: 'Bucuresti',
    countyCode: 'RO-B',
    country: 'RO',
    iban: 'RO49AAAA1B31007593840000',
    bank: 'Revolut Bank',
    email: 'stefan@vanadium.systems',
  },
  customer: {
    name: 'Client SaaS SRL',
    cif: '22222222',
    address: 'Str. Client 2',
    city: 'Cluj-Napoca',
    country: 'RO',
  },
  lines: [
    { description: 'Abonament vanagreen — iulie 2026', quantity: 1, unitPrice: 400, vatRate: 21 },
    { description: 'Setup fee', quantity: 2, unitPrice: 100, vatRate: 21 },
  ],
}

describe('computeTotals', () => {
  it('computes line extension, VAT and gross totals grouped by rate', () => {
    const totals = computeTotals(input.lines)
    expect(totals.lineExtensionAmount).toBe(600)
    expect(totals.taxAmount).toBe(126)
    expect(totals.taxInclusiveAmount).toBe(726)
    expect(totals.byRate).toEqual([{ rate: 21, taxable: 600, tax: 126 }])
  })

  it('handles vatRate 0 (neplătitor)', () => {
    const totals = computeTotals([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: 0 }])
    expect(totals.taxAmount).toBe(0)
    expect(totals.taxInclusiveAmount).toBe(100)
  })
})

describe('buildInvoiceXml', () => {
  const xml = buildInvoiceXml(input)

  it('produces CIUS-RO customization and identity fields', () => {
    expect(xml).toContain('urn:efactura.mfinante.ro:CIUS-RO:1.0.1')
    expect(xml).toContain('<cbc:ID>VAN-2026-0001</cbc:ID>')
    expect(xml).toContain('<cbc:IssueDate>2026-07-04</cbc:IssueDate>')
    expect(xml).toContain('<cbc:DueDate>2026-08-03</cbc:DueDate>')
    expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>')
  })

  it('includes both parties with RO VAT ids and county code', () => {
    expect(xml).toContain('<cbc:RegistrationName>Vanadium Systems SRL</cbc:RegistrationName>')
    expect(xml).toContain('<cbc:CompanyID>RO11111111</cbc:CompanyID>')
    expect(xml).toContain('<cbc:RegistrationName>Client SaaS SRL</cbc:RegistrationName>')
    expect(xml).toContain('<cbc:CountrySubentity>RO-B</cbc:CountrySubentity>')
  })

  it('includes payment means with IBAN', () => {
    expect(xml).toContain('<cbc:ID>RO49AAAA1B31007593840000</cbc:ID>')
  })

  it('computes monetary totals', () => {
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">600.00</cbc:LineExtensionAmount>')
    expect(xml).toContain('<cbc:TaxAmount currencyID="RON">126.00</cbc:TaxAmount>')
    expect(xml).toContain('<cbc:PayableAmount currencyID="RON">726.00</cbc:PayableAmount>')
  })

  it('escapes XML entities in text fields', () => {
    const withAmp = buildInvoiceXml({
      ...input,
      customer: { ...input.customer, name: 'A & B <SRL>' },
    })
    expect(withAmp).toContain('A &amp; B &lt;SRL&gt;')
    expect(withAmp).not.toContain('A & B <SRL>')
  })
})

// Regression: an invoice ANAF rejected on four CIUS-RO schematron errors, all specific to a
// seller that is not registered for VAT (art. 310), where every line is category O.
describe('buildInvoiceXml — neplătitor de TVA (art. 310), toate liniile categoria O', () => {
  const neplatitorInput: UblInvoiceInput = {
    ...input,
    customer: { ...input.customer, regCom: 'J08/798/2018' },
    lines: [{ description: 'Abonament', quantity: 1, unitPrice: 209.54, vatRate: 0 }],
  }
  const xml = buildInvoiceXml(neplatitorInput)

  it('nu include PartyTaxScheme (BR-O-02 — fără VAT ID când nicio linie nu are TVA)', () => {
    expect(xml).not.toContain('<cac:PartyTaxScheme>')
  })

  it('nu include Percent pe liniile/subtotalurile categoria O (BR-O-04 / BR-O-05)', () => {
    expect(xml).not.toContain('<cbc:Percent>')
  })

  it('nu include CompanyLegalForm pe AccountingCustomerParty (UBL-CR-244)', () => {
    const customerBlock = xml.slice(xml.indexOf('<cac:AccountingCustomerParty>'))
    expect(customerBlock).not.toContain('<cbc:CompanyLegalForm>')
    // dar rămâne pe furnizor
    expect(xml).toContain('<cbc:CompanyLegalForm>J40/1234/2025</cbc:CompanyLegalForm>')
  })

  it('nu inventează un CountrySubentity pt. client fără countyCode (BR-RO-100)', () => {
    const customerBlock = xml.slice(xml.indexOf('<cac:AccountingCustomerParty>'))
    expect(customerBlock).not.toContain('<cbc:CountrySubentity>')
    // dar rămâne pe furnizor, unde chiar e cunoscut
    expect(xml).toContain('<cbc:CountrySubentity>RO-B</cbc:CountrySubentity>')
  })
})
