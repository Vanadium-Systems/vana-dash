import { eq } from 'drizzle-orm'
import * as archiveService from '../../modules/archive/service.js'
import { db } from '../db/client.js'
import { financialRecords } from '../db/schema/index.js'
import { readDocument } from './storage.js'

// Automatic archiving of incoming/outgoing invoices into the Archive module:
// Contabilitate -> LL-AAAA -> Facturi furnizori/clienti -> <counterparty>.
// Best-effort and idempotent: an error here never blocks ANAF sync, invoice issue, or email ingest.

export interface ArchivableInvoice {
  recordId?: string | null
  direction: 'in' | 'out'
  issuedAt: Date
  counterpartyName: string | null
  counterpartyCif: string | null
  /** Invoice number - for incoming e-Factura records this is NOT financialRecords.documentNumber (reserved for our own outgoing numbering sequence), but the supplier's number extracted from the ANAF XML/PDF or email, passed explicitly by the caller. */
  documentNumber: string | null
  anafMessageId: string | null
  /** Primary PDF path - our generated PDF for outgoing invoices when present, otherwise the e-Factura or supplier email PDF. */
  pdfStoragePath: string | null
  xmlStoragePath: string | null
  /** Outgoing invoices only: the ANAF-rendered PDF for our own issued invoice, distinct from our generated PDF. Archived separately as <number>_ANAF.pdf when available (may arrive on a later sync-anaf run after validation). */
  anafPdfStoragePath?: string | null
}

function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[/\\]/g, '_').trim()
  return cleaned || 'Necunoscut'
}

async function archiveDocumentIfMissing(
  folderId: string,
  name: string,
  storagePath: string,
  mimeType: string,
): Promise<string | null> {
  try {
    const existing = await archiveService.findFileByName(folderId, name)
    // Already archived - idempotent, safe to re-run on every sync.
    if (existing) return existing.id
    const buffer = await readDocument(storagePath)
    const uploaded = await archiveService.uploadSystemFile({ folderId, name, mimeType, buffer })
    return uploaded.id
  } catch (err) {
    // ENOENT (ANAF file not yet downloaded) is a normal transient state - log and continue with the remaining documents.
    console.error(`[financial-archive] could not archive "${name}" from "${storagePath}": ${String(err)}`)
    return null
  }
}

export async function archiveInvoiceDocuments(
  invoice: ArchivableInvoice,
): Promise<{ pdfArchiveFileId: string | null; xmlArchiveFileId: string | null }> {
  let folderId: string
  try {
    const typeFolder = invoice.direction === 'in' ? 'Facturi furnizori' : 'Facturi clienti'
    const counterpartyFolder = sanitizeName(invoice.counterpartyName ?? invoice.counterpartyCif ?? 'Necunoscut')
    // Root is the company's systemArchiveRoot - with per-user spaces, background jobs write into the space designated for the company archive rather than a shared root.
    folderId = await archiveService.ensureFolderPath(await archiveService.systemArchiveRoot(), [
      'Contabilitate',
      archiveService.monthYearFolderName(invoice.issuedAt),
      typeFolder,
      counterpartyFolder,
    ])
  } catch (err) {
    console.error(
      `[financial-archive] could not prepare folder for invoice ${invoice.documentNumber ?? invoice.anafMessageId ?? invoice.recordId}: ${String(err)}`,
    )
    return { pdfArchiveFileId: null, xmlArchiveFileId: null }
  }

  const baseName = sanitizeName(invoice.documentNumber ?? invoice.anafMessageId ?? invoice.recordId ?? 'document')

  let pdfArchiveFileId: string | null = null
  let xmlArchiveFileId: string | null = null

  if (invoice.pdfStoragePath) {
    pdfArchiveFileId = await archiveDocumentIfMissing(folderId, `${baseName}.pdf`, invoice.pdfStoragePath, 'application/pdf')
  }
  if (invoice.xmlStoragePath) {
    xmlArchiveFileId = await archiveDocumentIfMissing(folderId, `${baseName}.xml`, invoice.xmlStoragePath, 'application/xml')
  }
  if (invoice.direction === 'out' && invoice.anafPdfStoragePath) {
    await archiveDocumentIfMissing(folderId, `${baseName}_ANAF.pdf`, invoice.anafPdfStoragePath, 'application/pdf')
  }

  const primaryArchiveId = pdfArchiveFileId ?? xmlArchiveFileId
  if (invoice.recordId && primaryArchiveId) {
    try {
      await db
        .update(financialRecords)
        .set({ archiveFileId: primaryArchiveId, updatedAt: new Date() })
        .where(eq(financialRecords.id, invoice.recordId))
    } catch (err) {
      console.error(`[financial-archive] could not link archiveFileId on record ${invoice.recordId}: ${String(err)}`)
    }
  }

  return { pdfArchiveFileId, xmlArchiveFileId }
}
