import cron from 'node-cron'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { anafConnector } from '../connectors/anaf/index.js'
import type { UblInvoiceInput } from '../connectors/anaf/types.js'
import { config } from '../shared/config.js'
import { db } from '../shared/db/client.js'
import { billingClients, financialRecords, invoiceLineItems } from '../shared/db/schema/index.js'
import { getAnafSession } from '../shared/lib/anaf.js'
import { generateInvoiceDocuments } from '../shared/lib/documents.js'
import { sendAlertEmail, sendEmail } from '../shared/lib/email.js'
import { archiveInvoiceDocuments } from '../shared/lib/financial-archive.js'
import { notifyPush } from '../shared/lib/push.js'
import { readDocument } from '../shared/lib/storage.js'

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
          `e-Factura respinsă: ${record.documentNumber ?? record.id}`,
          `Factura ${record.documentNumber ?? record.id} a fost respinsă de ANAF.\n` +
            'Verifică XML-ul în vana-dash → Accounting → Emise și retrimite după corectare.',
        )
        void notifyPush('invoiceStatus', {
          title: 'e-Factura respinsă',
          body: `Factura ${record.documentNumber ?? record.id} a fost respinsă de ANAF.`,
          url: '/accounting',
        })
      } else if (status === 'validated') {
        void notifyPush('invoiceStatus', {
          title: 'e-Factura validată',
          body: `Factura ${record.documentNumber ?? record.id} a fost validată de ANAF.`,
          url: '/accounting',
        })
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
        `Factura ${documentNumber} — generare PDF eșuată`,
        `Factura ${documentNumber} a fost validată de ANAF dar generarea PDF a eșuat.\n` +
          `Trimite-o manual clientului după ce rezolvi problema. Eroare: ${String(err)}`,
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
      `Factura ${documentNumber} — trimite manual`,
      `Factura ${documentNumber} a fost validată de ANAF dar PDF-ul nu a putut fi generat ` +
        '(Chromium indisponibil). Trimite-o manual clientului.',
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
        `Bună,\n\nAtașat factura ${documentNumber}, emisă de ${config.company.name}.\n\n` +
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
  if (!client) throw new Error('Clientul facturii nu mai există')
  if (!config.company.cif) {
    throw new Error('Profilul firmei incomplet: setează COMPANY_CIF (+ adresă/IBAN) în .env')
  }

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
    supplier: {
      name: config.company.name,
      cif: config.company.cif,
      regCom: config.company.regCom || undefined,
      address: config.company.address,
      city: config.company.city,
      countyCode: config.company.countyCode,
      country: 'RO',
      iban: config.company.iban || undefined,
      bank: config.company.bank || undefined,
      email: config.company.email || undefined,
    },
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
