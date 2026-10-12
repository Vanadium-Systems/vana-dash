import { XMLParser } from 'fast-xml-parser'
import type { AnafInvoiceDocument, SpvMessage } from '../types.js'
import type { AnafEfacturaMessage } from './types.js'
import { tr } from '../../shared/lib/i18n.js'

// Mapare răspunsuri ANAF → tipurile comune din connectors/types.ts.
// XML-ul e-Factura e UBL 2.1 cu namespace-uri (cbc:, cac:) — le eliminăm la parsare.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
})

/** data_creare ANAF: yyyyMMddHHmm (ora României; o tratăm ca locală serverului). */
export function parseAnafDate(value: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value)
  if (!m) return new Date(NaN)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
}

function text(node: unknown): string | null {
  if (node == null) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text'])
  }
  return null
}

function get(obj: unknown, ...path: string[]): unknown {
  let cur = obj
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[key]
    if (Array.isArray(cur)) cur = cur[0]
  }
  return cur
}

/** true dacă documentul e o notă de credit (storno), nu o factură — relevant pt. /transformare (FCN vs FACT1). */
export function isCreditNoteXml(xml: string): boolean {
  return /<(?:\w+:)?CreditNote[\s>]/.test(xml)
}

function parseInvoiceCore(
  xml: string,
  message: AnafEfacturaMessage,
  party: 'AccountingSupplierParty' | 'AccountingCustomerParty',
): AnafInvoiceDocument {
  const doc = parser.parse(xml) as Record<string, unknown>
  const invoice = (doc.Invoice ?? doc.CreditNote ?? {}) as Record<string, unknown>

  const counterpartyParty = get(invoice, party, 'Party')
  const counterpartyName =
    text(get(counterpartyParty, 'PartyLegalEntity', 'RegistrationName')) ??
    text(get(counterpartyParty, 'PartyName', 'Name'))
  const counterpartyCif =
    text(get(counterpartyParty, 'PartyTaxScheme', 'CompanyID')) ??
    text(get(counterpartyParty, 'PartyLegalEntity', 'CompanyID'))

  const totalNode =
    get(invoice, 'LegalMonetaryTotal', 'TaxInclusiveAmount') ??
    get(invoice, 'LegalMonetaryTotal', 'PayableAmount')
  const amount = Number(text(totalNode) ?? 'NaN')
  const currency =
    (typeof totalNode === 'object' && totalNode !== null
      ? String((totalNode as Record<string, unknown>)['@_currencyID'] ?? '')
      : '') ||
    text(get(invoice, 'DocumentCurrencyCode')) ||
    'RON'

  const issueDate = text(get(invoice, 'IssueDate'))
  const dueDate = text(get(invoice, 'DueDate'))

  return {
    anafMessageId: message.id,
    documentNumber: text(get(invoice, 'ID')),
    counterpartyName,
    counterpartyCif: counterpartyCif ? counterpartyCif.replace(/^RO/i, '') : null,
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
    issuedAt: issueDate ? new Date(issueDate) : parseAnafDate(message.data_creare),
    dueAt: dueDate ? new Date(dueDate) : null,
    xml,
    // Setat de apelant (connectors/anaf/index.ts) după descărcarea arhivei/transformare —
    // parse*-urile lucrează strict pe XML-ul deja extras, nu văd PDF-ul.
    pdf: null,
    meta: {
      anafRequestId: message.id_solicitare,
      detalii: message.detalii,
    },
  }
}

/**
 * Parsează XML-ul UBL al unei facturi PRIMITE → AnafInvoiceDocument (contraparte = furnizor).
 * `message` e mesajul din listaMesajePaginatieFactura care a produs descărcarea.
 */
export function parseUblInvoice(xml: string, message: AnafEfacturaMessage): AnafInvoiceDocument {
  return parseInvoiceCore(xml, message, 'AccountingSupplierParty')
}

/**
 * Parsează XML-ul UBL al unei facturi EMISE (tip 'FACTURA TRIMISA') → AnafInvoiceDocument
 * (contraparte = client). Simetric cu parseUblInvoice, doar citește cealaltă parte din XML.
 */
export function parseUblInvoiceOutgoing(xml: string, message: AnafEfacturaMessage): AnafInvoiceDocument {
  return parseInvoiceCore(xml, message, 'AccountingCustomerParty')
}

export function transformSpvMessage(message: AnafEfacturaMessage): SpvMessage {
  return {
    id: message.id,
    type: message.tip,
    detail: message.detalii,
    cif: message.cif,
    createdAt: parseAnafDate(message.data_creare),
  }
}

/** Răspunsul XML de la /upload: <header ExecutionStatus="0" index_incarcare="123"/>. */
export function parseUploadResponse(xml: string): { uploadId: string } {
  const doc = parser.parse(xml) as Record<string, unknown>
  const header = (doc.header ?? {}) as Record<string, unknown>
  const executionStatus = String(header['@_ExecutionStatus'] ?? '')
  const uploadId = String(header['@_index_incarcare'] ?? '')
  if (executionStatus !== '0' || !uploadId) {
    const errors = JSON.stringify(header.Errors ?? header).slice(0, 500)
    throw new Error(tr('errors.anaf.uploadRejected', { executionStatus, errors }))
  }
  return { uploadId }
}

/** Răspunsul XML de la /stareMesaj: <header stare="ok|nok|in prelucrare"/>. */
export function parseUploadStatusResponse(xml: string): 'pending' | 'validated' | 'rejected' {
  const doc = parser.parse(xml) as Record<string, unknown>
  const header = (doc.header ?? {}) as Record<string, unknown>
  const stare = String(header['@_stare'] ?? '').toLowerCase()
  if (stare === 'ok') return 'validated'
  if (stare === 'nok') return 'rejected'
  return 'pending'
}
