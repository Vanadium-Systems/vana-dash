import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { billingClients, financialRecords } from '../db/schema/index.js'
import { config } from '../config.js'
import { renderPaymentConfirmationHtml } from './documents.js'
import { sendEmail } from './email.js'
import { htmlToPdf, isPdfAvailable } from './pdf.js'

// Trimite „Confirmare de încasare" (PDF de curtoazie, NU chitanță — vezi documents.ts)
// pe emailul clientului după ce o factură emisă trece pe 'paid'. Apelat din DOUĂ locuri
// care nu trebuie să se importe între ele (reconciliation/service.ts și bank-sync.ts) —
// trăiește în shared/lib, nu într-un modul, exact ca maybeExtendSubscription.
// Nu aruncă niciodată — apelantul face fire-and-forget (`.catch`), acțiunea primară
// (marcarea plătit) e deja commisă înainte de acest apel.
export async function sendPaymentConfirmationEmail(financialRecordId: string): Promise<void> {
  const [record] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, financialRecordId), isNull(financialRecords.deletedAt)))
  if (!record || record.direction !== 'out' || record.type !== 'invoice') return
  if (!record.billingClientId) return // factură manuală/veche fără client mapat — nimic de trimis

  const [client] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.id, record.billingClientId), isNull(billingClients.deletedAt)))
  if (!client?.email) {
    console.warn(
      `[payment-confirmation] Factura ${record.documentNumber ?? record.id} plătită, dar clientul nu are email — sar peste.`,
    )
    return
  }

  const documentNumber = record.documentNumber ?? record.id
  const amount = Number(record.amount)
  const html = renderPaymentConfirmationHtml({
    documentNumber,
    amount,
    currency: record.currency,
    paidAt: record.paidAt ?? new Date(),
    clientName: client.name,
    company: { name: config.company.name, email: config.company.email },
  })

  let pdfBuffer: Buffer | null = null
  if (isPdfAvailable()) {
    try {
      pdfBuffer = await htmlToPdf(html)
    } catch (err) {
      console.error(`[payment-confirmation] PDF eșuat pentru ${documentNumber}: ${String(err)}`)
      // continuăm fără atașament — nu e document fiscal, un email fără PDF tot are valoare
    }
  }

  await sendEmail({
    to: client.email,
    subject: `Confirmare încasare — Factura ${documentNumber}`,
    text:
      `Bună,\n\nAm primit plata pentru factura ${documentNumber} ` +
      `(${amount.toFixed(2)} ${record.currency}). Mulțumim!\n\n` +
      `Acesta este un mesaj automat, generat de ${config.company.name}.`,
    attachments: pdfBuffer ? [{ filename: `confirmare-${documentNumber}.pdf`, content: pdfBuffer }] : [],
  })
}
