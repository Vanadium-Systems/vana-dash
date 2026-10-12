import * as archiveService from '../../modules/archive/service.js'
import { readDocument } from './storage.js'

// Arhivare automată a facturilor (primite/emise) în modulul Arhivă, oglindind organizarea
// manuală a lui Stefan: Contabilitate → LL-AAAA → Facturi furnizori/clienti → <contraparte>.
// Apelat din jobs/sync-anaf.ts (primite + emise, orar) și jobs/poll-anaf-upload-status.ts
// (emise, la validare ANAF) — best-effort, idempotent, nu aruncă niciodată: o eroare aici
// nu trebuie să blocheze sync-ul ANAF sau trimiterea facturii (regula #7 CLAUDE.md).

interface ArchivableInvoice {
  direction: 'in' | 'out'
  issuedAt: Date
  counterpartyName: string | null
  counterpartyCif: string | null
  /** Numărul facturii — pt. cele primite NU e financialRecords.documentNumber (mereu null
   *  acolo, rezervat secvenței proprii), ci numărul din documentul ANAF, dat explicit de caller. */
  documentNumber: string | null
  anafMessageId: string | null
  /** Calea "principală" — a noastră dacă există (facturi emise), altfel cea din e-Factura. */
  pdfStoragePath: string | null
  xmlStoragePath: string | null
  /** Doar pt. direction='out': PDF-ul randat de ANAF pt. propria factură emisă, distinct de
   *  cel generat de noi — arhivat separat dacă/când devine disponibil (poate ajunge mai
   *  târziu decât validarea, la următoarea rulare sync-anaf). */
  anafPdfStoragePath?: string | null
}

function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[/\\]/g, '_').trim()
  return cleaned || 'Necunoscut'
}

async function archiveDocumentIfMissing(folderId: string, name: string, storagePath: string, mimeType: string): Promise<void> {
  try {
    const existing = await archiveService.findFileByName(folderId, name)
    if (existing) return // deja arhivat — idempotent, sigur de reapelat la fiecare sync
    const buffer = await readDocument(storagePath)
    await archiveService.uploadSystemFile({ folderId, name, mimeType, buffer })
  } catch (err) {
    // ENOENT (fișierul ANAF încă nedescărcat) e o stare normală, tranzitorie — nu o tratăm
    // diferit de alte eșecuri, doar logăm și continuăm cu restul documentelor facturii.
    console.error(`[financial-archive] nu am putut arhiva "${name}" din "${storagePath}": ${String(err)}`)
  }
}

export async function archiveInvoiceDocuments(invoice: ArchivableInvoice): Promise<void> {
  let folderId: string
  try {
    const typeFolder = invoice.direction === 'in' ? 'Facturi furnizori' : 'Facturi clienti'
    const counterpartyFolder = sanitizeName(invoice.counterpartyName ?? invoice.counterpartyCif ?? 'Necunoscut')
    // Rădăcina e a lui Stefan (`systemArchiveRoot`) — cu spații per om, jobul nu mai scrie într-o
    // rădăcină comună, ci în spațiul ales pentru arhiva firmei.
    folderId = await archiveService.ensureFolderPath(await archiveService.systemArchiveRoot(), [
      'Contabilitate',
      archiveService.monthYearFolderName(invoice.issuedAt),
      typeFolder,
      counterpartyFolder,
    ])
  } catch (err) {
    console.error(`[financial-archive] nu am putut pregăti folderul pt. factura ${invoice.documentNumber ?? invoice.anafMessageId}: ${String(err)}`)
    return
  }

  const baseName = sanitizeName(invoice.documentNumber ?? invoice.anafMessageId ?? 'document')

  if (invoice.pdfStoragePath) {
    await archiveDocumentIfMissing(folderId, `${baseName}.pdf`, invoice.pdfStoragePath, 'application/pdf')
  }
  if (invoice.xmlStoragePath) {
    await archiveDocumentIfMissing(folderId, `${baseName}.xml`, invoice.xmlStoragePath, 'application/xml')
  }
  if (invoice.direction === 'out' && invoice.anafPdfStoragePath) {
    await archiveDocumentIfMissing(folderId, `${baseName}_ANAF.pdf`, invoice.anafPdfStoragePath, 'application/pdf')
  }
}
