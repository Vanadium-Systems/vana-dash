import type { UblInvoiceInput, UblInvoiceLine, UblInvoiceTotals, UblParty } from './types.js'

// Generare XML UBL 2.1 conform CIUS-RO (RO_CIUS) pentru facturile emise.
// Validarea finală o face schematron-ul ANAF — testează pe sandbox înainte de prod.

const CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1'

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(value: number): string {
  return value.toFixed(2)
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Cotele 0% se emit ca "O" (neplătitor / operațiune în afara sferei TVA). */
function taxCategory(rate: number): { id: string; exemptionReason?: string } {
  if (rate > 0) return { id: 'S' }
  return { id: 'O', exemptionReason: 'Neplatitor de TVA conform art. 310 Cod Fiscal' }
}

export function computeTotals(lines: UblInvoiceLine[]): UblInvoiceTotals {
  const byRateMap = new Map<number, { rate: number; taxable: number; tax: number }>()
  let lineExtensionAmount = 0

  for (const line of lines) {
    const taxable = round2(line.quantity * line.unitPrice)
    lineExtensionAmount = round2(lineExtensionAmount + taxable)
    const bucket = byRateMap.get(line.vatRate) ?? { rate: line.vatRate, taxable: 0, tax: 0 }
    bucket.taxable = round2(bucket.taxable + taxable)
    byRateMap.set(line.vatRate, bucket)
  }
  for (const bucket of byRateMap.values()) {
    bucket.tax = round2((bucket.taxable * bucket.rate) / 100)
  }
  const taxAmount = round2([...byRateMap.values()].reduce((acc, b) => acc + b.tax, 0))

  return {
    lineExtensionAmount,
    taxAmount,
    taxInclusiveAmount: round2(lineExtensionAmount + taxAmount),
    byRate: [...byRateMap.values()].sort((a, b) => a.rate - b.rate),
  }
}

function partyXml(
  tag: 'AccountingSupplierParty' | 'AccountingCustomerParty',
  party: UblParty,
  hasVat: boolean,
): string {
  // PartyTaxScheme/CompanyID (BT-31) poartă prefixul de țară; PartyLegalEntity rămâne CIF-ul gol.
  const cifWithPrefix = party.cif.toUpperCase().startsWith('RO')
    ? party.cif.toUpperCase()
    : `RO${party.cif}`
  return `
    <cac:${tag}>
      <cac:Party>
        <cac:PostalAddress>
          <cbc:StreetName>${esc(party.address)}</cbc:StreetName>
          <cbc:CityName>${esc(party.city)}</cbc:CityName>${
            party.countyCode ? `\n          <cbc:CountrySubentity>${esc(party.countyCode)}</cbc:CountrySubentity>` : ''
          }
          <cac:Country><cbc:IdentificationCode>${esc(party.country)}</cbc:IdentificationCode></cac:Country>
        </cac:PostalAddress>${
          hasVat
            ? `
        <cac:PartyTaxScheme>
          <cbc:CompanyID>${esc(cifWithPrefix)}</cbc:CompanyID>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:PartyTaxScheme>`
            : ''
        }
        <cac:PartyLegalEntity>
          <cbc:RegistrationName>${esc(party.name)}</cbc:RegistrationName>
          <cbc:CompanyID>${esc(party.cif)}</cbc:CompanyID>${
            party.regCom && tag === 'AccountingSupplierParty'
              ? `\n          <cbc:CompanyLegalForm>${esc(party.regCom)}</cbc:CompanyLegalForm>`
              : ''
          }
        </cac:PartyLegalEntity>${
          party.email
            ? `\n        <cac:Contact><cbc:ElectronicMail>${esc(party.email)}</cbc:ElectronicMail></cac:Contact>`
            : ''
        }
      </cac:Party>
    </cac:${tag}>`
}

export function buildInvoiceXml(input: UblInvoiceInput): string {
  const totals = computeTotals(input.lines)
  const cur = input.currency
  // BR-O-02: pe o factură fără nicio linie cu TVA (neplătitor art. 310, toate liniile
  // categoria "O"), identificatorii de TVA ai părților nu trebuie incluși deloc.
  const hasVat = totals.byRate.some((b) => b.rate > 0)

  const taxSubtotals = totals.byRate
    .map((bucket) => {
      const cat = taxCategory(bucket.rate)
      // BR-O-04: categoria "O" nu poate avea o cotă asociată (BT-119).
      const percent = cat.id === 'O' ? '' : `\n          <cbc:Percent>${bucket.rate.toFixed(2)}</cbc:Percent>`
      return `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${cur}">${money(bucket.taxable)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${cur}">${money(bucket.tax)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${cat.id}</cbc:ID>${percent}${
            cat.exemptionReason
              ? `\n          <cbc:TaxExemptionReason>${esc(cat.exemptionReason)}</cbc:TaxExemptionReason>`
              : ''
          }
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`
    })
    .join('')

  const lines = input.lines
    .map((line, i) => {
      const cat = taxCategory(line.vatRate)
      const lineAmount = round2(line.quantity * line.unitPrice)
      // BR-O-05: o linie categoria "O" nu poate avea o cotă asociată (BT-152).
      const percent = cat.id === 'O' ? '' : `\n          <cbc:Percent>${line.vatRate.toFixed(2)}</cbc:Percent>`
      return `
    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="H87">${line.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${cur}">${money(lineAmount)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${esc(line.description)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${cat.id}</cbc:ID>${percent}
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="${cur}">${money(line.unitPrice)}</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID>
  <cbc:ID>${esc(input.documentNumber)}</cbc:ID>
  <cbc:IssueDate>${isoDate(input.issuedAt)}</cbc:IssueDate>${
    input.dueAt ? `\n  <cbc:DueDate>${isoDate(input.dueAt)}</cbc:DueDate>` : ''
  }
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${
    input.note ? `\n  <cbc:Note>${esc(input.note)}</cbc:Note>` : ''
  }
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>${partyXml(
    'AccountingSupplierParty',
    input.supplier,
    hasVat,
  )}${partyXml('AccountingCustomerParty', input.customer, hasVat)}${
    input.supplier.iban
      ? `
    <cac:PaymentMeans>
      <cbc:PaymentMeansCode>31</cbc:PaymentMeansCode>
      <cac:PayeeFinancialAccount>
        <cbc:ID>${esc(input.supplier.iban)}</cbc:ID>${
          input.supplier.bank ? `\n        <cbc:Name>${esc(input.supplier.bank)}</cbc:Name>` : ''
        }
      </cac:PayeeFinancialAccount>
    </cac:PaymentMeans>`
      : ''
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${money(totals.taxAmount)}</cbc:TaxAmount>${taxSubtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${money(totals.lineExtensionAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${money(totals.lineExtensionAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${money(totals.taxInclusiveAmount)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${money(totals.taxInclusiveAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>
`
}
