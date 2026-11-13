import { describe, expect, it } from 'vitest'
import type { UblInvoiceInput } from '../../connectors/anaf/types.js'
import { renderInvoiceHtml } from './documents.js'

const party = { name: 'Acme SRL', cif: 'RO1234567', address: 'Str. Exemplu 1', city: 'Brasov', country: 'RO' }
const input: UblInvoiceInput = {
  documentNumber: 'VAN-0042',
  issuedAt: new Date('2026-11-12T12:00:00Z'),
  dueAt: null,
  currency: 'RON',
  supplier: party,
  customer: party,
  lines: [{ description: 'Service', quantity: 2, unitPrice: 250, vatRate: 19 }],
}

describe('renderInvoiceHtml', () => {
  it('prints the number of an issued invoice', () => {
    expect(renderInvoiceHtml(input)).toContain('VAN-0042')
  })

  it('replaces the number with the band on a draft preview', () => {
    const html = renderInvoiceHtml({ ...input, documentNumber: '' }, undefined, { draftLabel: 'Draft' })
    expect(html).toContain('draft-band">Draft<')
    expect(html).not.toContain('Seria/Nr')
  })

  it('titles a storno and says which invoice it reverses', () => {
    const html = renderInvoiceHtml({
      ...input,
      documentNumber: 'VAN-0043',
      corrects: { documentNumber: 'VAN-0042', issuedAt: new Date('2026-10-12T10:00:00Z') },
      lines: [{ description: 'Service', quantity: -2, unitPrice: 250, vatRate: 19 }],
    })
    expect(html).toContain('<h1>Factură storno</h1>')
    expect(html).toContain('Stornează factura VAN-0042 din 12.10.2026')
    expect(html).toContain('-500.00 RON')
  })

  it('keeps FACTURĂ and no reference on an ordinary invoice', () => {
    const html = renderInvoiceHtml(input)
    expect(html).toContain('<h1>FACTURĂ</h1>')
    expect(html).not.toContain('Stornează')
  })

  it('marks a proforma as not a tax invoice', () => {
    const html = renderInvoiceHtml({ ...input, documentNumber: 'PRO-0001' }, undefined, { proforma: true })
    expect(html).toContain('<h1>Proformă</h1>')
    expect(html).toContain('Proformă · nu este factură fiscală')
    expect(html).toContain('PRO-0001')
  })
})
