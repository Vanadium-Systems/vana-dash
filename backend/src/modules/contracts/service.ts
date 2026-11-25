import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { contractDocuments } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { inspectPdf, isSigningAvailable } from '../../shared/lib/pdf-signing.js'
import { saveDocument } from '../../shared/lib/storage.js'
import { httpError } from '../../shared/lib/http-error.js'
import { revokeActive } from './signing-service.js'

export async function getDocument(documentId: string) {
  const [row] = await db
    .select()
    .from(contractDocuments)
    .where(and(eq(contractDocuments.id, documentId), isNull(contractDocuments.deletedAt)))
  return row ?? null
}

export async function markDocumentSigned(documentId: string, isSigned: boolean) {
  const [row] = await db
    .update(contractDocuments)
    .set({ isSigned, signedAt: isSigned ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(contractDocuments.id, documentId), isNull(contractDocuments.deletedAt)))
    .returning()
  if (row) {
    await recordAudit({
      action: isSigned ? 'contract.semnat' : 'contract.semnatura.anulata',
      entityType: 'contract_document',
      entityId: row.id,
      changes: { isSigned: [!isSigned, isSigned] },
    })
  }
  return row ?? null
}

// ── Digital signature: the PDF signed outside the app comes back as a new version ──
// Signing with a qualified token happens on the signer's computer, not on the backend; the signed
// PDF is stored as a NEW document (the original stays, so the history is complete).

/** Upload of a signed PDF: a new document with `sourceDocumentId` = the original, never an overwrite. */
export async function uploadSignedDocument(documentId: string, pdfBuffer: Buffer) {
  const source = await getDocument(documentId)
  if (!source) throw httpError(400, 'CONTRACT_DOCUMENT_NOT_FOUND')
  const stamp = Date.now()
  // What the file says about its own signatures, shown on the contract page; a file pyHanko cannot read is still kept.
  const signatures = isSigningAvailable() ? await inspectPdf(pdfBuffer).then((r) => r.signatures, () => null) : null
  const pdfStoragePath = await saveDocument(`contracts/registry/${source.contractId}/semnat_${source.docType}_${stamp}.pdf`, pdfBuffer)

  const row = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contractDocuments)
      .values({
        billingClientId: source.billingClientId,
        contractId: source.contractId,
        docType: source.docType,
        pdfStoragePath,
        isSigned: true,
        signedAt: new Date(),
        sourceDocumentId: source.id,
        signatures,
      })
      .returning()
    // A new revision makes the links sent for the old one useless.
    await revokeActive(tx, source.contractId)
    return row!
  })
  await recordAudit({
    action: 'contract.pdf.semnat.incarcat',
    entityType: 'contract_document',
    entityId: row.id,
    changes: { sursa: [null, source.id] },
  })
  return row
}
