import { and, desc, eq, isNull } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { db } from '../../shared/db/client.js'
import { billingClients, contractAddenda, contractDocuments } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { assertContractDataComplete, formatMonthlyPrice } from '../../shared/lib/contract-templates.js'
import { htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import { ContractDetailsSchema, type ContractDetails, type CreateAddendumSchema, type SignatureRectSchema } from './schema.js'
import { renderAddendum, renderDocument } from './templates-service.js'
import type { z } from 'zod'
import { tr } from '../../shared/lib/i18n.js'

// Format A4 (puncte PDF, 72dpi) — identic paginii generate de htmlToPdf (shared/lib/pdf.ts,
// format: 'A4') — bază pt. conversia dreptunghiului normalizat (0..1) în coordonate JSignPdf.
const PDF_PAGE_WIDTH_PT = 595
const PDF_PAGE_HEIGHT_PT = 842

// modules/contracts/ NU importă servicii din accounting/ sau invoicing/ (izolare, CLAUDE.md #5)
// — doar schema DB (billing_clients), la fel cum reconciliation/ sau prospects/ citesc
// billingClients fără să fie „parte din" accounting.

async function getClientOrThrow(clientId: string) {
  const [client] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.id, clientId), isNull(billingClients.deletedAt)))
  if (!client) throw new Error(tr('errors.contracts.clientNotFound'))
  return client
}

/** contractDetails e jsonb liber — `.parse()` OBLIGATORIU la citire, nu doar la scriere (vezi
 * bug whitescreen Pricing 2026-07-24: un `.default()` Zod nu protejează dacă service-ul citește
 * direct din DB fără parse). Rândurile fără contractDetails încă (null) devin obiect gol valid. */
function parseContractDetails(raw: unknown): ContractDetails {
  return ContractDetailsSchema.parse(raw ?? {})
}

// Read-only — scrierea pe billing_clients (inclusiv contactName/contactTitle/phone/
// contractPlan/contractDetails) rămâne EXCLUSIV în modules/invoicing/ (PATCH
// /api/invoicing/clients/:id, ClientFormDialog.tsx), ca să nu existe două căi de scriere
// necoordonate pe același rând. Aici doar citim și validăm shape-ul jsonb.
export async function getContractInfo(clientId: string) {
  const client = await getClientOrThrow(clientId)
  return { ...client, contractDetails: parseContractDetails(client.contractDetails) }
}

export async function generateDocument(clientId: string, docType: 'contract' | 'anexa') {
  const client = await getClientOrThrow(clientId)
  const details = parseContractDetails(client.contractDetails)
  assertContractDataComplete(client, details)

  const monthlyPriceFormatted = formatMonthlyPrice(client)
  const html = await renderDocument(docType, { client, details, monthlyPriceFormatted })

  if (!isPdfAvailable()) throw new Error(tr('errors.pdf.unavailableRetry'))
  const pdf = await htmlToPdf(html)

  const safeName = client.name.replace(/[^A-Za-z0-9_-]/g, '_')
  const stamp = Date.now()
  const pdfStoragePath = await saveDocument(`contracts/${clientId}/${docType}_${safeName}_${stamp}.pdf`, pdf)

  const [row] = await db
    .insert(contractDocuments)
    .values({ billingClientId: clientId, docType, pdfStoragePath })
    .returning()
  return row!
}

// Randare + conversie PDF directă, fără `assertContractDataComplete` și fără persistare —
// Stefan o folosește să vadă cum arată contractul (ca PDF, la fel ca varianta reală) înainte
// ca toate câmpurile obligatorii să fie completate (câmpurile lipsă cad deja pe fallback-ul
// „—" din contract-templates.ts).
export async function previewDocument(clientId: string, docType: 'contract' | 'anexa'): Promise<Buffer> {
  const client = await getClientOrThrow(clientId)
  const details = parseContractDetails(client.contractDetails)
  const monthlyPriceFormatted = formatMonthlyPrice(client)
  const html = await renderDocument(docType, { client, details, monthlyPriceFormatted })

  if (!isPdfAvailable()) throw new Error(tr('errors.pdf.unavailableRetry'))
  return htmlToPdf(html)
}

export async function listDocuments(clientId: string) {
  await getClientOrThrow(clientId)
  return db
    .select()
    .from(contractDocuments)
    .where(and(eq(contractDocuments.billingClientId, clientId), isNull(contractDocuments.deletedAt)))
    .orderBy(desc(contractDocuments.createdAt))
}

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

export async function listAddenda(clientId: string) {
  await getClientOrThrow(clientId)
  return db
    .select()
    .from(contractAddenda)
    .where(and(eq(contractAddenda.billingClientId, clientId), isNull(contractAddenda.deletedAt)))
    .orderBy(desc(contractAddenda.number))
}

/** Numerotare per-client în tranzacție (MAX(number)+1, `FOR UPDATE` implicit via lock pe rândurile
 *  clientului) — pattern analog `nextInvoiceNumber`, dar scopat pe client, nu global. */
export async function createAddendum(clientId: string, input: z.infer<typeof CreateAddendumSchema>) {
  await getClientOrThrow(clientId)
  const row = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ number: contractAddenda.number })
      .from(contractAddenda)
      .where(and(eq(contractAddenda.billingClientId, clientId), isNull(contractAddenda.deletedAt)))
      .for('update')
    const nextNumber = existing.reduce((max, r) => Math.max(max, r.number), 0) + 1

    const [row] = await tx
      .insert(contractAddenda)
      .values({ billingClientId: clientId, number: nextNumber, ...input })
      .returning()
    return row!
  })
  await recordAudit({
    action: 'contract.anexa.creata',
    entityType: 'contract_addendum',
    entityId: row.id,
    changes: { numar: [null, row.number], continut: [null, Object.keys(input).join(', ')] },
  })
  return row
}

export async function generateAddendumDocument(addendumId: string) {
  const [addendum] = await db
    .select()
    .from(contractAddenda)
    .where(and(eq(contractAddenda.id, addendumId), isNull(contractAddenda.deletedAt)))
  if (!addendum) throw new Error(tr('errors.contracts.addendumNotFound'))

  const client = await getClientOrThrow(addendum.billingClientId)
  const details = parseContractDetails(client.contractDetails)
  if (!details.nrContract || !details.dataContract) {
    throw new Error(tr('errors.contracts.missingData'))
  }

  const html = await renderAddendum(addendum, client, { nrContract: details.nrContract, dataContract: details.dataContract })

  if (!isPdfAvailable()) throw new Error(tr('errors.pdf.unavailableRetry'))
  const pdf = await htmlToPdf(html)

  const safeName = client.name.replace(/[^A-Za-z0-9_-]/g, '_')
  const stamp = Date.now()
  const pdfStoragePath = await saveDocument(`contracts/${addendum.billingClientId}/act_aditional_${addendum.number}_${safeName}_${stamp}.pdf`, pdf)

  const [row] = await db
    .insert(contractDocuments)
    .values({ billingClientId: addendum.billingClientId, docType: 'act_aditional', addendumId: addendum.id, pdfStoragePath })
    .returning()
  return row!
}

// ── Semnătură digitală — tab „Semnează" (2026-09-03) ──────────────────────────────────────────
// Constrângere reală: tokenul virtual certSIGN al lui Stefan e legat de Windows, semnarea NU
// poate rula pe backend-ul din Docker de pe VPS. Dash-ul doar (a) ține minte dreptunghiul ales,
// (b) generează un pachet descărcabil cu PDF-ul + comanda JSignPdf gata completată, (c) primește
// înapoi PDF-ul semnat ca document NOU (nu suprascrie originalul — pattern identic regenerării).

async function getDocumentOrThrow(documentId: string) {
  const doc = await getDocument(documentId)
  if (!doc) throw new Error(tr('errors.contracts.documentNotFound'))
  return doc
}

export async function saveSignatureRect(documentId: string, rect: z.infer<typeof SignatureRectSchema>) {
  const [row] = await db
    .update(contractDocuments)
    .set({ signatureRect: rect, updatedAt: new Date() })
    .where(and(eq(contractDocuments.id, documentId), isNull(contractDocuments.deletedAt)))
    .returning()
  return row ?? null
}

/**
 * Pachet descărcabil (.zip): PDF-ul curent + un README cu comanda JSignPdf gata completată
 * (keystore Windows-MY/MSCAPI — certificatul certSIGN al lui Stefan trebuie să apară acolo ca
 * cert de utilizator Windows) pt. coordonatele salvate cu saveSignatureRect. Stefan rulează
 * comanda local pe Windows, apoi urcă rezultatul cu uploadSignedDocument.
 */
export async function buildSignPackage(documentId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const doc = await getDocumentOrThrow(documentId)
  if (!doc.signatureRect) throw new Error(tr('errors.contracts.pickSignatureBox'))

  const pdfBuffer = await readDocument(doc.pdfStoragePath)
  const rect = doc.signatureRect as z.infer<typeof SignatureRectSchema>
  // JSignPdf: originea e colț stânga-jos, Y crește în sus — inversăm Y-ul normalizat (UI
  // desenează de sus în jos, ca un PDF viewer obișnuit).
  const llx = Math.round(rect.x * PDF_PAGE_WIDTH_PT)
  const width = Math.round(rect.width * PDF_PAGE_WIDTH_PT)
  const height = Math.round(rect.height * PDF_PAGE_HEIGHT_PT)
  const ury = Math.round(PDF_PAGE_HEIGHT_PT - rect.y * PDF_PAGE_HEIGHT_PT)
  const urx = llx + width
  const lly = ury - height

  const pdfFileName = `${doc.docType}_${doc.id.slice(0, 8)}.pdf`
  const command = `jsignpdf.bat -klavecert -kst WINDOWS-MY -llx ${llx} -lly ${lly} -urx ${urx} -ury ${ury} -page ${rect.page} -d . -op semnat_ "${pdfFileName}"`
  const readme = tr('errors.contracts.signReadme', { file: pdfFileName, command })

  const zipEntries: Record<string, Uint8Array> = {
    [pdfFileName]: new Uint8Array(pdfBuffer),
    [tr('errors.contracts.signReadmeName')]: new TextEncoder().encode(readme),
  }
  return { buffer: Buffer.from(zipSync(zipEntries)), fileName: `semnare_${doc.id.slice(0, 8)}.zip` }
}

/**
 * Upload PDF semnat — creează un document NOU (`sourceDocumentId` = originalul), NU suprascrie
 * — istoricul complet rămâne, la fel ca regenerarea contract/anexă.
 */
export async function uploadSignedDocument(documentId: string, pdfBuffer: Buffer) {
  const source = await getDocumentOrThrow(documentId)
  const stamp = Date.now()
  const pdfStoragePath = await saveDocument(`contracts/${source.billingClientId}/semnat_${source.docType}_${stamp}.pdf`, pdfBuffer)

  const [row] = await db
    .insert(contractDocuments)
    .values({
      billingClientId: source.billingClientId,
      docType: source.docType,
      addendumId: source.addendumId,
      pdfStoragePath,
      isSigned: true,
      signedAt: new Date(),
      sourceDocumentId: source.id,
    })
    .returning()
  await recordAudit({
    action: 'contract.pdf.semnat.incarcat',
    entityType: 'contract_document',
    entityId: row!.id,
    changes: { sursa: [null, source.id] },
  })
  return row!
}
