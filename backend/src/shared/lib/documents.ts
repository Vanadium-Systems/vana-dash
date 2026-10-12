import { buildInvoiceXml, computeTotals } from '../../connectors/anaf/xml-builder.js'
import type { UblInvoiceInput } from '../../connectors/anaf/types.js'
import { htmlToPdf, isPdfAvailable } from './pdf.js'
import { saveDocument } from './storage.js'

// Generarea documentelor unei facturi emise: XML UBL (pentru ANAF), HTML (mereu)
// și PDF (doar dacă există Chromium — vezi pdf.ts). Căile relative intră în
// financial_records.{xml,pdf}_storage_path.

export interface InvoiceDocumentPaths {
  xmlPath: string
  pdfPath: string | null
}

// Info cosmetică — doar HTML/PDF, XML-ul UBL trimis la ANAF n-o folosește (rămâne strict
// în moneda facturii, cum cere schema). rate = RON per 1 EUR (convenția getRateForDate).
export interface BnrRateInfo {
  rate: number
  date: string
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`
}

export function renderInvoiceHtml(input: UblInvoiceInput, eurRate?: BnrRateInfo): string {
  const totals = computeTotals(input.lines)
  const showEur = eurRate && input.currency !== 'EUR'
  const rows = input.lines
    .map(
      (line, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${esc(line.description)}</td>
          <td class="num">${line.quantity}</td>
          <td class="num">${money(line.unitPrice, input.currency)}${showEur ? `<br><span class="alt">${money(line.unitPrice / eurRate.rate, 'EUR')}</span>` : ''}</td>
          <td class="num">${line.vatRate.toFixed(0)}%</td>
          <td class="num">${money(line.quantity * line.unitPrice, input.currency)}</td>
        </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 12px; margin: 0; }
  h1 { font-size: 20px; letter-spacing: 2px; margin: 0 0 2px; }
  .head { display: flex; justify-content: space-between; margin-bottom: 24px; }
  .muted { color: #666; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
  .party { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .party h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { text-align: left; border-bottom: 2px solid #1a1a1a; padding: 6px 8px; font-size: 11px; text-transform: uppercase; }
  td { border-bottom: 1px solid #eee; padding: 6px 8px; }
  .num { text-align: right; white-space: nowrap; }
  .alt { color: #999; font-size: 10px; }
  .totals { margin-left: auto; width: 260px; }
  .totals td { padding: 4px 8px; }
  .totals .grand { font-weight: bold; font-size: 14px; border-top: 2px solid #1a1a1a; }
  .totals .rate-note { text-align: right; font-size: 10px; color: #999; padding-top: 2px; }
  .note { margin-top: 24px; font-size: 11px; color: #666; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>FACTURĂ</h1>
      <div class="muted">Seria/Nr: <strong>${esc(input.documentNumber)}</strong></div>
    </div>
    <div style="text-align:right">
      <div>Data emiterii: <strong>${input.issuedAt.toISOString().slice(0, 10)}</strong></div>
      ${input.dueAt ? `<div>Scadență: <strong>${input.dueAt.toISOString().slice(0, 10)}</strong></div>` : ''}
    </div>
  </div>
  <div class="parties">
    <div class="party">
      <h3>Furnizor</h3>
      <strong>${esc(input.supplier.name)}</strong><br>
      CIF: ${esc(input.supplier.cif)}${input.supplier.regCom ? ` · ${esc(input.supplier.regCom)}` : ''}<br>
      ${esc(input.supplier.address)}, ${esc(input.supplier.city)}<br>
      ${input.supplier.iban ? `IBAN: ${esc(input.supplier.iban)}${input.supplier.bank ? ` (${esc(input.supplier.bank)})` : ''}<br>` : ''}
      ${input.supplier.email ? esc(input.supplier.email) : ''}
    </div>
    <div class="party">
      <h3>Client</h3>
      <strong>${esc(input.customer.name)}</strong><br>
      CIF: ${esc(input.customer.cif)}${input.customer.regCom ? ` · ${esc(input.customer.regCom)}` : ''}<br>
      ${esc(input.customer.address)}, ${esc(input.customer.city)}<br>
      ${input.customer.iban ? `IBAN: ${esc(input.customer.iban)}${input.customer.bank ? ` (${esc(input.customer.bank)})` : ''}<br>` : ''}
      ${input.customer.email ? esc(input.customer.email) : ''}
    </div>
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Descriere</th><th class="num">Cant.</th><th class="num">Preț unitar</th><th class="num">TVA</th><th class="num">Valoare</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td class="num">${money(totals.lineExtensionAmount, input.currency)}</td></tr>
    <tr><td>TVA</td><td class="num">${money(totals.taxAmount, input.currency)}</td></tr>
    <tr class="grand"><td>Total de plată</td><td class="num">${money(totals.taxInclusiveAmount, input.currency)}</td></tr>
  </table>
  ${showEur ? `<div class="totals rate-note">Curs BNR: 1 EUR = ${eurRate.rate.toFixed(4)} RON (${eurRate.date})</div>` : ''}
  ${input.note ? `<div class="note">${esc(input.note)}</div>` : ''}
  ${input.lines.every((l) => l.vatRate === 0) ? '<div class="note">Neplătitor de TVA conform art. 310 Cod Fiscal.</div>' : ''}
</body>
</html>`
}

export interface PaymentConfirmationRenderInput {
  documentNumber: string
  amount: number
  currency: string
  paidAt: Date
  clientName: string
  company: { name: string; email: string }
}

// PDF de curtoazie, NU document fiscal — trimis pe email după ce o factură emisă
// trece pe 'paid' (manual sau auto-match bancar). NU se numește „chitanță" nicăieri
// (chitanța e document justificativ legal STRICT pt. încasare în numerar, OMFP 2634/2015
// cod 14-4-1 — o plată prin transfer bancar nu are nevoie de una, vezi PLAN.md).
export function renderPaymentConfirmationHtml(input: PaymentConfirmationRenderInput): string {
  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 13px; margin: 0; padding: 32px; }
  h1 { font-size: 18px; margin: 0 0 20px; }
  .row { margin-bottom: 8px; }
  .label { color: #666; display: inline-block; width: 140px; }
  .amount { font-size: 16px; font-weight: bold; }
  .note { margin-top: 24px; font-size: 11px; color: #999; }
</style>
</head>
<body>
  <h1>Confirmare de încasare</h1>
  <div class="row"><span class="label">Client</span>${esc(input.clientName)}</div>
  <div class="row"><span class="label">Factură</span>${esc(input.documentNumber)}</div>
  <div class="row"><span class="label">Sumă încasată</span><span class="amount">${money(input.amount, input.currency)}</span></div>
  <div class="row"><span class="label">Data încasării</span>${input.paidAt.toISOString().slice(0, 10)}</div>
  <p>Bună,<br>Confirmăm că am primit plata pentru factura de mai sus. Mulțumim!</p>
  <div class="note">
    Acesta este un document informativ, generat automat de ${esc(input.company.name)}
    (${esc(input.company.email)}) — NU este o chitanță fiscală și nu ține loc de document justificativ.
  </div>
</body>
</html>`
}

/**
 * Generează și salvează XML + HTML (+ PDF dacă e disponibil Chromium) pentru o factură.
 * Returnează căile relative de stocare. Lipsa PDF-ului NU e o eroare.
 */
export async function generateInvoiceDocuments(
  invoiceId: string,
  input: UblInvoiceInput,
  eurRate?: BnrRateInfo,
): Promise<InvoiceDocumentPaths> {
  const year = input.issuedAt.getUTCFullYear()
  const safeNumber = input.documentNumber.replace(/[^A-Za-z0-9_-]/g, '_')
  const base = `invoices/${year}/${safeNumber}_${invoiceId.slice(0, 8)}`

  const xml = buildInvoiceXml(input)
  const xmlPath = await saveDocument(`${base}.xml`, xml)

  const html = renderInvoiceHtml(input, eurRate)
  await saveDocument(`${base}.html`, html)

  let pdfPath: string | null = null
  if (isPdfAvailable()) {
    try {
      pdfPath = await saveDocument(`${base}.pdf`, await htmlToPdf(html))
    } catch (err) {
      console.error(`[documents] PDF generation failed pentru ${input.documentNumber}: ${String(err)}`)
    }
  }

  return { xmlPath, pdfPath }
}
