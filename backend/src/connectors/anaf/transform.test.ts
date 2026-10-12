import { describe, expect, it } from 'vitest'
import {
  isCreditNoteXml,
  parseAnafDate,
  parseUblInvoice,
  parseUblInvoiceOutgoing,
  parseUploadResponse,
  parseUploadStatusResponse,
} from './transform.js'
import type { AnafEfacturaMessage } from './types.js'

const message: AnafEfacturaMessage = {
  id: '3001234567',
  data_creare: '202606151030',
  cif: '12345678',
  id_solicitare: '5001234567',
  detalii: 'Factura cu id_incarcare=5001234567 emisa de cif_emitent=87654321 pentru cif_beneficiar=12345678',
  tip: 'FACTURA PRIMITA',
}

const outgoingMessage: AnafEfacturaMessage = {
  ...message,
  id: '3009999999',
  tip: 'FACTURA TRIMISA',
}

const sampleUbl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>FURN-2026-042</cbc:ID>
  <cbc:IssueDate>2026-06-14</cbc:IssueDate>
  <cbc:DueDate>2026-07-14</cbc:DueDate>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>RO87654321</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Furnizor Test SRL</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxInclusiveAmount currencyID="RON">1190.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">1190.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`

describe('anaf transform', () => {
  it('parses data_creare (yyyyMMddHHmm)', () => {
    const date = parseAnafDate('202606151030')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(5)
    expect(date.getDate()).toBe(15)
    expect(date.getHours()).toBe(10)
  })

  it('parses UBL invoice into AnafInvoiceDocument (contraparte = furnizor)', () => {
    const invoice = parseUblInvoice(sampleUbl, message)
    expect(invoice.anafMessageId).toBe('3001234567')
    expect(invoice.documentNumber).toBe('FURN-2026-042')
    expect(invoice.counterpartyName).toBe('Furnizor Test SRL')
    // Prefixul RO se scoate — counterparty_cif e CIF-ul numeric
    expect(invoice.counterpartyCif).toBe('87654321')
    expect(invoice.amount).toBe(1190)
    expect(invoice.currency).toBe('RON')
    expect(invoice.issuedAt.toISOString().slice(0, 10)).toBe('2026-06-14')
    expect(invoice.dueAt?.toISOString().slice(0, 10)).toBe('2026-07-14')
    expect(invoice.xml).toBe(sampleUbl)
  })

  it('parses UBL invoice emisă cu AccountingCustomerParty ca și contraparte', () => {
    const outgoingUbl = sampleUbl.replace(/AccountingSupplierParty/g, 'AccountingCustomerParty')
    const invoice = parseUblInvoiceOutgoing(outgoingUbl, outgoingMessage)
    expect(invoice.anafMessageId).toBe('3009999999')
    expect(invoice.documentNumber).toBe('FURN-2026-042')
    expect(invoice.counterpartyName).toBe('Furnizor Test SRL')
    expect(invoice.counterpartyCif).toBe('87654321')
    expect(invoice.amount).toBe(1190)
  })

  it('detects CreditNote root element', () => {
    expect(isCreditNoteXml(sampleUbl)).toBe(false)
    expect(isCreditNoteXml(sampleUbl.replace(/Invoice/g, 'CreditNote'))).toBe(true)
  })

  it('parses upload response with index_incarcare', () => {
    const xml = '<?xml version="1.0"?><header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202606151200" ExecutionStatus="0" index_incarcare="5009876543"/>'
    expect(parseUploadResponse(xml)).toEqual({ uploadId: '5009876543' })
  })

  it('throws on upload response with errors', () => {
    const xml = '<?xml version="1.0"?><header ExecutionStatus="1"><Errors errorMessage="CIF invalid"/></header>'
    expect(() => parseUploadResponse(xml)).toThrow(/ExecutionStatus=1/)
  })

  it('maps stareMesaj states', () => {
    expect(parseUploadStatusResponse('<header stare="ok"/>')).toBe('validated')
    expect(parseUploadStatusResponse('<header stare="nok"/>')).toBe('rejected')
    expect(parseUploadStatusResponse('<header stare="in prelucrare"/>')).toBe('pending')
  })
})
