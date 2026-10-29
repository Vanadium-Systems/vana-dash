import cron from 'node-cron'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { anafConnector } from '../connectors/anaf/index.js'
import { supplierParty } from '../connectors/anaf/supplier.js'
import type { UblInvoiceInput } from '../connectors/anaf/types.js'
import { db } from '../shared/db/client.js'
import { billingClients, financialRecords, invoiceLineItems } from '../shared/db/schema/index.js'
import { getAnafSession } from '../shared/lib/anaf.js'
import { getCompany } from '../shared/lib/company.js'
import { generateInvoiceDocuments } from '../shared/lib/documents.js'
import { sendAlertEmail, sendEmail } from '../shared/lib/email.js'
import { archiveInvoiceDocuments } from '../shared/lib/financial-archive.js'
import { notifyPush } from '../shared/lib/push.js'
import { readDocument } from '../shared/lib/storage.js'
import { tr, trFor } from '../shared/lib/i18n.js'

// Verifică starea de validare a facturilor trimise la ANAF (anaf_status='pending').
// La 'validated': generează PDF-ul dacă lipsește (poate Chromium era indisponibil la
// `issue`) și trimite factura clientului din billing_clients pe email, cu PDF atașat.
// La 'rejected': alertă internă (existent).

const CRON_EXPR = '*/10 * * * *'

export function startAnafUploadPollJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void pollAnafUploadStatuses().catch((err) => {
      console.error(`[poll-anaf-upload] ${String(err)}`)
    })
  })
  console.log(`[poll-anaf-upload] Scheduled (${CRON_EXPR})`)
}

type PendingRecord = {
  id: string
  documentNumber: string | null
  anafUploadId: string | null
  anafMessageId: string | null
  billingClientId: string | null
  counterpartyName: string | null
  counterpartyCif: string | null
  pdfStoragePath: string | null
  xmlStoragePath: string | null
  issuedAt: Date
  dueAt: Date | null
  currency: string
  description: string | null
}

export async function pollAnafUploadStatuses(): Promise<void> {
  const pending: PendingRecord[] = await db
    .select({
      id: financialRecords.id,
      documentNumber: financialRecords.documentNumber,
      anafUploadId: financialRecords.anafUploadId,
      anafMessageId: financialRecords.anafMessageId,
      billingClientId: financialRecords.billingClientId,
      counterpartyName: financialRecords.counterpartyName,
      counterpartyCif: financialRecords.counterpartyCif,
      pdfStoragePath: financialRecords.pdfStoragePath,
      xmlStoragePath: financialRecords.xmlStoragePath,
      issuedAt: financialRecords.issuedAt,
      dueAt: financialRecords.dueAt,
      currency: financialRecords.currency,
      description: financialRecords.description,
    })
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.anafStatus, 'pending'),
        isNotNull(financialRecords.anafUploadId),
        isNull(financialRecords.deletedAt),
      ),
    )
  if (pending.length === 0) return

  const session = await getAnafSession()
  for (const record of pending) {
    // Failure izolat per factură — un stareMesaj picat nu blochează restul.
    try {
      const status = await anafConnector.checkUploadStatus(session, record.anafUploadId!)
      if (status === 'pending') continue

      await db
        .update(financialRecords)
        .set({ anafStatus: status, updatedAt: new Date() })
        .where(eq(financialRecords.id, record.id))

      if (status === 'rejected') {
        await sendAlertEmail(
          tr('emails.efactura.rejectedSubject', { documentNumber: record.documentNumber ?? record.id }),
          tr('emails.efactura.rejectedBody1', { documentNumber: record.documentNumber ?? record.id }) +
            tr('emails.efactura.rejectedBody2'),
        )
        void notifyPush('invoiceStatus', (locale) => ({
          title: trFor(locale, 'push.efactura.rejectedTitle'),
          body: trFor(locale, 'push.efactura.rejectedBody', { documentNumber: record.documentNumber ?? record.id }),
          url: '/accounting',
        }))
      } else if (status === 'validated') {
        void notifyPush('invoiceStatus', (locale) => ({
          title: trFor(locale, 'push.efactura.validatedTitle'),
          body: trFor(locale, 'push.efactura.validatedBody', { documentNumber: record.documentNumber ?? record.id }),
          url: '/accounting',
        }))
        // Statusul e deja scris mai sus — ce urmează (generare PDF + email) e best-effort,
        // nu mai poate "rata" tranziția: rândul nu mai apare la rulările următoare
        // (query-ul de mai sus filtrează pe anaf_status='pending'), deci trigger-ul e
        // natural o singură dată, fără flag suplimentar.
        await sendValidatedInvoiceEmail(record)
      }
    } catch (err) {
      console.error(`[poll-anaf-upload] stareMesaj eșuat pentru ${record.documentNumber}: ${String(err)}`)
    }
  }
}

/**
 * La validarea ANAF a unei facturi emise: generează PDF-ul dacă lipsește și trimite
 * email cu PDF atașat clientului din billing_clients. Niciun eșec de aici nu blochează
 * nimic mai sus — statusul 'validated' e deja persistat înainte de acest apel.
 */
async function sendValidatedInvoiceEmail(record: PendingRecord): Promise<void> {
  const documentNumber = record.documentNumber ?? record.id

  if (!record.billingClientId) {
    console.warn(
      `[poll-anaf-upload] Factura ${documentNumber} validată dar fără billing_client ` +
        '(intrare manuală/veche) — sar peste generare PDF + email.',
    )
    return
  }

  const [client] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.id, record.billingClientId), isNull(billingClients.deletedAt)))

  let pdfPath = record.pdfStoragePath
  let xmlPath = record.xmlStoragePath
  if (!pdfPath) {
    try {
      const input = await buildInvoiceInputForEmail(record, client ?? null)
      const paths = await generateInvoiceDocuments(record.id, input)
      pdfPath = paths.pdfPath

      const updates: Record<string, unknown> = {}
      if (paths.pdfPath) updates.pdfStoragePath = paths.pdfPath
      if (!record.xmlStoragePath) {
        updates.xmlStoragePath = paths.xmlPath
        xmlPath = paths.xmlPath
      }
      if (Object.keys(updates).length > 0) {
        await db
          .update(financialRecords)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(financialRecords.id, record.id))
      }
    } catch (err) {
      console.error(`[poll-anaf-upload] Generare PDF eșuată pentru factura ${documentNumber}: ${String(err)}`)
      await sendAlertEmail(
        tr('emails.efactura.pdfFailedSubject', { documentNumber }),
        tr('emails.efactura.pdfFailedBody1', { documentNumber }) +
          tr('emails.efactura.pdfFailedBody2', { err: String(err) }),
      )
      return
    }
  }

  if (!pdfPath) {
    // isPdfAvailable() era false (Chromium neconfigurat) — nu e o eroare, doar o stare
    // de infra cunoscută. Nu blocăm nimic, doar alertăm ca Stefan să trimită manual.
    console.warn(
      `[poll-anaf-upload] Factura ${documentNumber} — PDF indisponibil (Chromium neconfigurat), nu trimit email.`,
    )
    await sendAlertEmail(
      tr('emails.efactura.sendManuallySubject', { documentNumber }),
      tr('emails.efactura.noPdfBody1', { documentNumber }) +
        tr('emails.efactura.noPdfBody2'),
    )
    return
  }

  // Arhivare best-effort — PDF-ul randat de ANAF (a treia copie) nu e disponibil aici încă
  // (anafMessageId se leagă abia la următoarea rulare jobs/sync-anaf.ts), doar calea lui
  // deterministă (aceeași formulă ca persistInvoiceDocuments) — dacă fișierul nu există pe
  // disc încă, archiveInvoiceDocuments sare peste el elegant, fără eroare.
  await archiveInvoiceDocuments({
    direction: 'out',
    issuedAt: record.issuedAt,
    counterpartyName: record.counterpartyName,
    counterpartyCif: record.counterpartyCif,
    documentNumber: record.documentNumber,
    anafMessageId: record.anafMessageId,
    pdfStoragePath: pdfPath,
    xmlStoragePath: xmlPath,
    anafPdfStoragePath: record.anafMessageId
      ? `outgoing/${record.issuedAt.getUTCFullYear()}/anaf_${record.anafMessageId}.pdf`
      : null,
  })

  if (!client?.email) {
    console.warn(
      `[poll-anaf-upload] Factura ${documentNumber} — clientul ${record.billingClientId} ` +
        'nu are email configurat, nu trimit.',
    )
    return
  }

  try {
    const pdfBuffer = await readDocument(pdfPath)
    await sendEmail({
      to: client.email,
      subject: `Factura ${documentNumber}`,
      text:
        `Bună,\n\nAtașat factura ${documentNumber}, emisă de ${(await getCompany()).profile.name}.\n\n` +
        'Acesta este un mesaj automat.',
      attachments: [{ filename: `${documentNumber}.pdf`, content: pdfBuffer }],
    })
  } catch (err) {
    console.error(`[poll-anaf-upload] Trimitere email eșuată pentru factura ${documentNumber}: ${String(err)}`)
  }
}

/** Construiește UblInvoiceInput din record + client + linii — oglindă a loadInvoiceInput din invoicing/service.ts. */
async function buildInvoiceInputForEmail(
  record: PendingRecord,
  client: typeof billingClients.$inferSelect | null,
): Promise<UblInvoiceInput> {
  if (!client) throw new Error(tr('errors.invoicing.clientGone'))
  const supplier = supplierParty(await getCompany())

  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.invoiceId, record.id), isNull(invoiceLineItems.deletedAt)))
    .orderBy(asc(invoiceLineItems.position))

  return {
    documentNumber: record.documentNumber ?? 'DRAFT',
    issuedAt: record.issuedAt,
    dueAt: record.dueAt,
    currency: record.currency,
    note: record.description ?? undefined,
    supplier,
    customer: {
      name: client.name,
      cif: client.cif,
      regCom: client.regCom ?? undefined,
      address: client.address,
      city: client.city ?? 'N/A',
      countyCode: undefined,
      country: client.country,
      email: client.email ?? undefined,
    },
    lines: lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      vatRate: Number(line.vatRate),
    })),
  }
}
