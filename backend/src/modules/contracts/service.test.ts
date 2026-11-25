/**
 * modules/contracts/service.ts — integration test on a real Postgres (test/setup.ts). The PDF inspection
 * and the disk are mocked at the boundary, never hit for real in a test.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, contractDocuments, contracts, users } from '../../shared/db/schema/index.js'

vi.mock('../../shared/lib/storage.js', () => ({
  saveDocument: async (path: string) => path,
  readDocument: async () => Buffer.from('%PDF-1.4 mock content'),
}))
vi.mock('../../shared/lib/pdf-signing.js', () => ({ isSigningAvailable: () => false, inspectPdf: async () => ({ signatures: [] }) }))

const service = await import('./service.js')

const contractIds: string[] = []
const documentIds: string[] = []

async function makeDocument() {
  const [owner] = await db.select({ id: users.id }).from(users).limit(1)
  const [contract] = await db
    .insert(contracts)
    .values({ title: 'Service QA', category: 'qa', counterpartyKind: 'other', counterpartyName: 'Acme SRL', ownerUserId: owner!.id, status: 'draft', origin: 'uploaded' })
    .returning()
  contractIds.push(contract!.id)
  const [doc] = await db.insert(contractDocuments).values({ contractId: contract!.id, docType: 'document', pdfStoragePath: 'contracts/qa.pdf' }).returning()
  documentIds.push(doc!.id)
  return doc!
}

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.entityId, documentIds))
  await db.delete(contractDocuments).where(inArray(contractDocuments.contractId, contractIds))
  await db.delete(contracts).where(inArray(contracts.id, contractIds))
})

describe('markDocumentSigned', () => {
  it('sets isSigned + signedAt on true, clears signedAt on false', async () => {
    const doc = await makeDocument()

    const signed = await service.markDocumentSigned(doc.id, true)
    expect(signed?.isSigned).toBe(true)
    expect(signed?.signedAt).not.toBeNull()

    const unsigned = await service.markDocumentSigned(doc.id, false)
    expect(unsigned?.isSigned).toBe(false)
    expect(unsigned?.signedAt).toBeNull()
  })

  it('returns null for a non-existent document', async () => {
    expect(await service.markDocumentSigned('00000000-0000-0000-0000-000000000000', true)).toBeNull()
  })

  it('leaves one history entry for signing and one for undoing it', async () => {
    const doc = await makeDocument()

    await service.markDocumentSigned(doc.id, true)
    await service.markDocumentSigned(doc.id, false)

    const entries = await db.select().from(auditLog).where(inArray(auditLog.entityId, [doc.id]))
    expect(entries.map((e) => e.action).sort()).toEqual(['contract.semnat', 'contract.semnatura.anulata'])
    expect(entries.find((e) => e.action === 'contract.semnat')!.changes).toEqual({ isSigned: [false, true] })
  })
})

describe('digital signature: uploading the signed PDF', () => {
  it('creates a NEW document (isSigned, signedAt, sourceDocumentId) and leaves the original untouched', async () => {
    const original = await makeDocument()

    const signed = await service.uploadSignedDocument(original.id, Buffer.from('%PDF-1.4 signed mock'))
    documentIds.push(signed.id)

    expect(signed.id).not.toBe(original.id)
    expect(signed.isSigned).toBe(true)
    expect(signed.signedAt).not.toBeNull()
    expect(signed.sourceDocumentId).toBe(original.id)
    expect(signed.contractId).toBe(original.contractId)
    expect((await service.getDocument(original.id))?.isSigned).toBe(false)
  })
})
