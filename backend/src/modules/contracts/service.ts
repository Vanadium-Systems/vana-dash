import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { billingClients, contractAddenda, contractDocuments } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { assertContractDataComplete, formatMonthlyPrice, REQUIRED_FIELD_LABELS, type ContractTemplateKey } from '../../shared/lib/contract-templates.js'
import { htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { saveDocument } from '../../shared/lib/storage.js'
import { ContractDetailsSchema, type ContractDetails, type CreateAddendumSchema } from './schema.js'
import { renderAddendum, renderBlank, renderDocument } from './templates-service.js'
import { ensureSaasContract, markSaasContractSigned } from './registry-service.js'
import { revokeActive } from './signing-service.js'
import { inspectPdf, isSigningAvailable } from '../../shared/lib/pdf-signing.js'
import { currentActor } from '../../shared/lib/request-context.js'
import { getCompany } from '../../shared/lib/company.js'
import type { z } from 'zod'
import { httpError } from '../../shared/lib/http-error.js'

// modules/contracts/ NU importă servicii din accounting/ sau invoicing/ (izolare, CLAUDE.md #5)
// — doar schema DB (billing_clients), la fel cum reconciliation/ sau prospects/ citesc
// billingClients fără să fie „parte din" accounting.

// `status` is the one the route used before codes: 404 where the client is the resource, 400 elsewhere.
async function getClientOrThrow(clientId: string, status = 400) {
  const [client] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.id, clientId), isNull(billingClients.deletedAt)))
  if (!client) throw httpError(status, 'CLIENT_NOT_FOUND')
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
  const client = await getClientOrThrow(clientId, 404)
  return { ...client, contractDetails: parseContractDetails(client.contractDetails) }
}

export async function generateDocument(clientId: string, docType: 'contract' | 'anexa') {
  const client = await getClientOrThrow(clientId)
  const details = parseContractDetails(client.contractDetails)
  assertContractDataComplete(client, details)

  const monthlyPriceFormatted = formatMonthlyPrice(client)
  const html = await renderDocument(docType, { client, details, monthlyPriceFormatted })

  if (!isPdfAvailable()) throw httpError(400, 'PDF_GENERATION_UNAVAILABLE')
  // Empty signature fields for the client, ready to sign in Adobe Reader with a qualified certificate.
  const pdf = await htmlToPdf(html, { signatureFields: await ownSignatureSkip(), offline: true })

  const safeName = client.name.replace(/[^A-Za-z0-9_-]/g, '_')
  const stamp = Date.now()
  const pdfStoragePath = await saveDocument(`contracts/${clientId}/${docType}_${safeName}_${stamp}.pdf`, pdf)

  return db.transaction(async (tx) => {
    const contractId = await ensureSaasContract(tx, clientId, actorUserId())
    const [row] = await tx
      .insert(contractDocuments)
      .values({ billingClientId: clientId, contractId, docType, pdfStoragePath })
      .returning()
    return row!
  })
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

  if (!isPdfAvailable()) throw httpError(400, 'PDF_GENERATION_UNAVAILABLE')
  return htmlToPdf(html, { offline: true })
}

// Like the preview, nothing is stored: the blank copy is generated again on every download.
export async function blankDocumentPdf(key: ContractTemplateKey): Promise<Buffer> {
  const html = await renderBlank(key)
  if (!isPdfAvailable()) throw httpError(400, 'PDF_GENERATION_UNAVAILABLE')
  return htmlToPdf(html, { offline: true })
}

export async function listDocuments(clientId: string) {
  await getClientOrThrow(clientId, 404)
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
  const row = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contractDocuments)
      .set({ isSigned, signedAt: isSigned ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(contractDocuments.id, documentId), isNull(contractDocuments.deletedAt)))
      .returning()
    if (row && isSigned && row.docType === 'contract') await markSaasContractSigned(tx, row.contractId, row.signedAt!)
    return row
  })
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
  await getClientOrThrow(clientId, 404)
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
  if (!addendum) throw httpError(400, 'CONTRACT_ADDENDUM_NOT_FOUND')

  const client = await getClientOrThrow(addendum.billingClientId)
  const details = parseContractDetails(client.contractDetails)
  if (!details.nrContract || !details.dataContract) {
    const fields = [REQUIRED_FIELD_LABELS.nrContract!, REQUIRED_FIELD_LABELS.dataContract!]
    throw httpError(400, 'CONTRACT_DATA_INCOMPLETE', { fields: fields.join(', ') }, { fields })
  }

  const html = await renderAddendum(addendum, client, { nrContract: details.nrContract, dataContract: details.dataContract })

  if (!isPdfAvailable()) throw httpError(400, 'PDF_GENERATION_UNAVAILABLE')
  const pdf = await htmlToPdf(html, { signatureFields: await ownSignatureSkip(), offline: true })

  const safeName = client.name.replace(/[^A-Za-z0-9_-]/g, '_')
  const stamp = Date.now()
  const pdfStoragePath = await saveDocument(`contracts/${addendum.billingClientId}/act_aditional_${addendum.number}_${safeName}_${stamp}.pdf`, pdf)

  return db.transaction(async (tx) => {
    const contractId = await ensureSaasContract(tx, addendum.billingClientId, actorUserId())
    const [row] = await tx
      .insert(contractDocuments)
      .values({ billingClientId: addendum.billingClientId, contractId, docType: 'act_aditional', addendumId: addendum.id, pdfStoragePath })
      .returning()
    return row!
  })
}

// ── Digital signature: the PDF signed outside the app comes back as a new version ──
// Semnarea cu tokenul certSIGN rulează pe calculatorul lui, nu pe backend; dash-ul primește PDF-ul semnat
// ca document NOU (nu suprascrie originalul, pattern identic regenerării).

async function getDocumentOrThrow(documentId: string) {
  const doc = await getDocument(documentId)
  if (!doc) throw httpError(400, 'CONTRACT_DOCUMENT_NOT_FOUND')
  return doc
}

/**
 * Upload PDF semnat — creează un document NOU (`sourceDocumentId` = originalul), NU suprascrie
 * — istoricul complet rămâne, la fel ca regenerarea contract/anexă.
 */
export async function uploadSignedDocument(documentId: string, pdfBuffer: Buffer) {
  const source = await getDocumentOrThrow(documentId)
  const stamp = Date.now()
  const folder = source.billingClientId ?? `registry/${source.contractId}`
  // What the file says about its own signatures, shown on the contract page; a file pyHanko cannot read is still kept.
  const signatures = isSigningAvailable() ? await inspectPdf(pdfBuffer).then((r) => r.signatures, () => null) : null
  const pdfStoragePath = await saveDocument(`contracts/${folder}/semnat_${source.docType}_${stamp}.pdf`, pdfBuffer)

  const row = await db.transaction(async (tx) => {
    const contractId = source.billingClientId ? await ensureSaasContract(tx, source.billingClientId, actorUserId()) : source.contractId
    const signedAt = new Date()
    const [row] = await tx
      .insert(contractDocuments)
      .values({
        billingClientId: source.billingClientId,
        contractId,
        docType: source.docType,
        addendumId: source.addendumId,
        pdfStoragePath,
        isSigned: true,
        signedAt,
        sourceDocumentId: source.id,
        signatures,
      })
      .returning()
    // A new revision makes the links sent for the old one useless.
    await revokeActive(tx, contractId)
    // A SaaS contract is signed by both sides on paper or in Adobe before it comes back. A registry document
    // is often signed by us first and then sent by link, so its status is changed by hand or by the link.
    if (source.docType === 'contract') await markSaasContractSigned(tx, contractId, signedAt)
    return row!
  })
  await recordAudit({
    action: 'contract.pdf.semnat.incarcat',
    entityType: 'contract_document',
    entityId: row!.id,
    changes: { sursa: [null, source.id] },
  })
  return row!
}

function actorUserId(): string | null {
  try {
    return currentActor().userId ?? null
  } catch {
    return null
  }
}

/** Our own signature line gets no empty field: we sign on webSIGN, which draws its own. */
async function ownSignatureSkip() {
  return { skipPartyName: (await getCompany()).profile.name ?? '' }
}
