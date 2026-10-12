/**
 * modules/contracts/service.ts — integration test, pg real (test/setup.ts). `htmlToPdf`/
 * `isPdfAvailable` (Chromium) și `saveDocument` (disc) mockuite la boundary — niciodată lovite
 * real într-un test, la fel ca la facturi (poll-anaf-upload-status.test.ts).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, billingClients, contractAddenda, contractDocuments, contractTemplates } from '../../shared/db/schema/index.js'
import { CONTRACT_TEMPLATE_BODIES } from '../../shared/lib/contract-templates.js'

const isPdfAvailableMock = vi.fn(() => true)
const htmlToPdfMock = vi.fn<(html: string) => Promise<Buffer>>(async () => Buffer.from('%PDF-1.4 mock'))
vi.mock('../../shared/lib/pdf.js', () => ({
  isPdfAvailable: () => isPdfAvailableMock(),
  htmlToPdf: (html: string) => htmlToPdfMock(html),
}))

const saveDocumentMock = vi.fn<(path: string, content: string | Buffer) => Promise<string>>(async (path) => path)
const readDocumentMock = vi.fn<(path: string) => Promise<Buffer>>(async () => Buffer.from('%PDF-1.4 mock content'))
vi.mock('../../shared/lib/storage.js', () => ({
  saveDocument: (path: string, content: string | Buffer) => saveDocumentMock(path, content),
  readDocument: (path: string) => readDocumentMock(path),
}))

const service = await import('./service.js')
const templatesService = await import('./templates-service.js')

const clientIds: string[] = []

async function makeClient(overrides: Partial<typeof billingClients.$inferInsert> = {}) {
  const [row] = await db
    .insert(billingClients)
    .values({
      name: 'Contracts QA Client',
      cif: 'RO99999999',
      address: 'Str. Test 42',
      ...overrides,
    })
    .returning()
  clientIds.push(row!.id)
  return row!
}

async function makeCompleteClient(overrides: Partial<typeof billingClients.$inferInsert> = {}) {
  return makeClient({
    contactName: 'Ion Popescu',
    contactTitle: 'Administrator',
    phone: '0722000000',
    contractPlan: 'Standard',
    subscriptionPriceEur: '100',
    subscriptionPriceCurrency: 'eur',
    contractDetails: { nrContract: '099', dataContract: '1 august 2026', taxaInitiere: '100 EUR', facturareTip: 'LUNAR' },
    ...overrides,
  })
}

beforeEach(() => {
  isPdfAvailableMock.mockReturnValue(true)
  htmlToPdfMock.mockClear()
  saveDocumentMock.mockClear()
})

afterEach(async () => {
  if (clientIds.length) {
    await db.delete(contractDocuments).where(inArray(contractDocuments.billingClientId, clientIds))
    await db.delete(contractAddenda).where(inArray(contractAddenda.billingClientId, clientIds))
  }
  // Rândurile de istor sunt șterse cu același id client ca documentele, ca să nu se piardă în
  // suita care Rulează secvențial pe aceeași bază.
  if (clientIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, [...clientIds]))
})

afterAll(async () => {
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
})

describe('getContractInfo', () => {
  it('parses a null contractDetails as an empty object (no throw)', async () => {
    const client = await makeClient()
    const info = await service.getContractInfo(client.id)
    expect(info.contractDetails).toEqual({})
  })

  it('throws for a non-existent client', async () => {
    await expect(service.getContractInfo('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/inexistent/)
  })
})

describe('generateDocument', () => {
  it('throws with the exact missing-fields message when client data is incomplete, and does not touch PDF/storage', async () => {
    const client = await makeClient()
    await expect(service.generateDocument(client.id, 'contract')).rejects.toThrow(/Date lipsă/)
    expect(htmlToPdfMock).not.toHaveBeenCalled()
    expect(saveDocumentMock).not.toHaveBeenCalled()
  })

  it('generates a contract PDF and stores a contract_documents row when data is complete', async () => {
    const client = await makeCompleteClient()
    const doc = await service.generateDocument(client.id, 'contract')
    expect(doc.docType).toBe('contract')
    expect(doc.billingClientId).toBe(client.id)
    expect(doc.isSigned).toBe(false)
    expect(htmlToPdfMock).toHaveBeenCalledTimes(1)
    expect(saveDocumentMock).toHaveBeenCalledTimes(1)
  })

  it('generates an anexa PDF distinctly from a contract', async () => {
    const client = await makeCompleteClient()
    const doc = await service.generateDocument(client.id, 'anexa')
    expect(doc.docType).toBe('anexa')
  })

  it('throws a clear error when Chromium is unavailable, without inserting a document row', async () => {
    isPdfAvailableMock.mockReturnValue(false)
    const client = await makeCompleteClient()
    await expect(service.generateDocument(client.id, 'contract')).rejects.toThrow(/PDF indisponibilă/)
    const rows = await db.select().from(contractDocuments).where(eq(contractDocuments.billingClientId, client.id))
    expect(rows).toHaveLength(0)
  })

  it('each generation creates a NEW row (istoric complet, nu suprascrie)', async () => {
    const client = await makeCompleteClient()
    await service.generateDocument(client.id, 'contract')
    await service.generateDocument(client.id, 'contract')
    const rows = await service.listDocuments(client.id)
    expect(rows).toHaveLength(2)
  })
})

describe('previewDocument', () => {
  it('converts to PDF for an incomplete client, without throwing or touching storage', async () => {
    const client = await makeClient()
    const pdf = await service.previewDocument(client.id, 'contract')
    expect(pdf).toBeInstanceOf(Buffer)
    expect(htmlToPdfMock).toHaveBeenCalledTimes(1)
    expect(htmlToPdfMock.mock.calls[0]![0]).toContain('CONTRACT DE SERVICII')
    expect(saveDocumentMock).not.toHaveBeenCalled()
  })

  it('does not insert a contract_documents row (nu e un document real, doar previzualizare)', async () => {
    const client = await makeCompleteClient()
    await service.previewDocument(client.id, 'contract')
    const rows = await db.select().from(contractDocuments).where(eq(contractDocuments.billingClientId, client.id))
    expect(rows).toHaveLength(0)
  })

  it('renders the anexă distinctly from the contract', async () => {
    const client = await makeCompleteClient()
    await service.previewDocument(client.id, 'anexa')
    expect(htmlToPdfMock.mock.calls[0]![0]).not.toContain('CONTRACT DE SERVICII')
  })

  it('throws a clear error when Chromium is unavailable', async () => {
    isPdfAvailableMock.mockReturnValue(false)
    const client = await makeCompleteClient()
    await expect(service.previewDocument(client.id, 'contract')).rejects.toThrow(/PDF indisponibilă/)
  })
})

describe('markDocumentSigned', () => {
  it('sets isSigned + signedAt on true, clears signedAt on false', async () => {
    const client = await makeCompleteClient()
    const doc = await service.generateDocument(client.id, 'contract')

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

  it('semnarea și anularea ei lasă câte o intrare în istoric (C2 — BE-7)', async () => {
    const client = await makeCompleteClient()
    const doc = await service.generateDocument(client.id, 'contract')

    await service.markDocumentSigned(doc.id, true)
    await service.markDocumentSigned(doc.id, false)

    const entries = await db
      .select()
      .from(auditLog)
      .where(inArray(auditLog.entityId, [doc.id]))
    expect(entries.map((e) => e.action).sort()).toEqual(['contract.semnat', 'contract.semnatura.anulata'])
    // No ORDER BY on the query: pick the entry by action, not by position.
    expect(entries.find((e) => e.action === 'contract.semnat')!.changes).toEqual({ isSigned: [false, true] })
  })
})

describe('semnătură digitală — signatureRect / sign-package / upload PDF semnat (2026-09-03)', () => {
  const rect = { page: 1, x: 0.6, y: 0.85, width: 0.25, height: 0.08 }

  it('saveSignatureRect persistă dreptunghiul, returnat de getDocument', async () => {
    const client = await makeCompleteClient()
    const doc = await service.generateDocument(client.id, 'contract')

    const row = await service.saveSignatureRect(doc.id, rect)
    expect(row?.signatureRect).toEqual(rect)

    const fetched = await service.getDocument(doc.id)
    expect(fetched?.signatureRect).toEqual(rect)
  })

  it('saveSignatureRect returnează null pt. un document inexistent', async () => {
    expect(await service.saveSignatureRect('00000000-0000-0000-0000-000000000000', rect)).toBeNull()
  })

  it('buildSignPackage aruncă dacă nu există încă un signatureRect salvat', async () => {
    const client = await makeCompleteClient()
    const doc = await service.generateDocument(client.id, 'contract')
    await expect(service.buildSignPackage(doc.id)).rejects.toThrow(/dreptunghiul de semnătură/)
  })

  it('buildSignPackage întoarce un .zip cu PDF-ul curent + un README cu comanda JSignPdf', async () => {
    const { unzipSync } = await import('fflate')
    const client = await makeCompleteClient()
    const doc = await service.generateDocument(client.id, 'contract')
    await service.saveSignatureRect(doc.id, rect)

    const { buffer, fileName } = await service.buildSignPackage(doc.id)
    expect(fileName).toMatch(/\.zip$/)
    expect(readDocumentMock).toHaveBeenCalledWith(doc.pdfStoragePath)

    const entries = unzipSync(new Uint8Array(buffer))
    const pdfEntry = Object.keys(entries).find((name) => name.endsWith('.pdf'))
    const readmeEntry = Object.keys(entries).find((name) => name.endsWith('.txt'))
    expect(pdfEntry).toBeDefined()
    expect(readmeEntry).toBeDefined()
    const readme = Buffer.from(entries[readmeEntry!]!).toString('utf-8')
    expect(readme).toContain('WINDOWS-MY')
    expect(readme).toContain('-page 1')
  })

  it('uploadSignedDocument creează un document NOU (isSigned, signedAt, sourceDocumentId), nu suprascrie originalul', async () => {
    const client = await makeCompleteClient()
    const original = await service.generateDocument(client.id, 'contract')

    const signed = await service.uploadSignedDocument(original.id, Buffer.from('%PDF-1.4 semnat mock'))

    expect(signed.id).not.toBe(original.id)
    expect(signed.isSigned).toBe(true)
    expect(signed.signedAt).not.toBeNull()
    expect(signed.sourceDocumentId).toBe(original.id)
    expect(signed.docType).toBe('contract')
    expect(signed.billingClientId).toBe(client.id)

    // Originalul rămâne intact (istoric complet, pattern identic regenerării).
    const untouchedOriginal = await service.getDocument(original.id)
    expect(untouchedOriginal?.isSigned).toBe(false)
  })
})

describe('createAddendum — numerotare per-client', () => {
  const addendumInput = {
    issuedAt: '2026-07-20',
    oldPriceNote: '100 RON/lună',
    newPriceNote: '40 EUR/lună',
    reason: 'test',
    effectiveDateNote: 'data semnării',
    temporary: false,
  }

  it('starts at 1 for a client with no addenda yet, increments sequentially', async () => {
    const client = await makeClient()
    const a1 = await service.createAddendum(client.id, addendumInput)
    const a2 = await service.createAddendum(client.id, addendumInput)
    const a3 = await service.createAddendum(client.id, addendumInput)
    expect([a1.number, a2.number, a3.number]).toEqual([1, 2, 3])
  })

  it('numbering is isolated PER CLIENT — a second client also starts at 1', async () => {
    const clientA = await makeClient({ cif: 'RO11111111' })
    const clientB = await makeClient({ cif: 'RO22222222' })
    await service.createAddendum(clientA.id, addendumInput)
    await service.createAddendum(clientA.id, addendumInput)
    const bFirst = await service.createAddendum(clientB.id, addendumInput)
    expect(bFirst.number).toBe(1)
  })

  it('listAddenda returns them ordered by number descending', async () => {
    const client = await makeClient()
    await service.createAddendum(client.id, addendumInput)
    await service.createAddendum(client.id, addendumInput)
    const rows = await service.listAddenda(client.id)
    expect(rows.map((r) => r.number)).toEqual([2, 1])
  })
})

describe('generateAddendumDocument', () => {
  it('throws when the client has no nrContract/dataContract set yet', async () => {
    const client = await makeClient()
    const addendum = await service.createAddendum(client.id, {
      issuedAt: '2026-07-20',
      oldPriceNote: 'a',
      newPriceNote: 'b',
      reason: 'c',
      effectiveDateNote: 'd',
      temporary: false,
    })
    await expect(service.generateAddendumDocument(addendum.id)).rejects.toThrow(/Date lipsă/)
  })

  it('generates a document with docType=act_aditional and addendumId set', async () => {
    const client = await makeCompleteClient()
    const addendum = await service.createAddendum(client.id, {
      issuedAt: '2026-07-20',
      oldPriceNote: 'a',
      newPriceNote: 'b',
      reason: 'c',
      effectiveDateNote: 'd',
      temporary: false,
    })
    const doc = await service.generateAddendumDocument(addendum.id)
    expect(doc.docType).toBe('act_aditional')
    expect(doc.addendumId).toBe(addendum.id)

    const [row] = await db
      .select()
      .from(contractDocuments)
      .where(and(eq(contractDocuments.id, doc.id), isNull(contractDocuments.deletedAt)))
    expect(row).toBeDefined()
  })
})

describe('șabloane seed-uite înainte de o schimbare de tokeni (Perioada Pilot scoasă, 2026-09)', () => {
  const staleBody = '<p>{{sectiunePilot}}</p>'

  afterEach(async () => {
    await templatesService.restoreTemplate('contract-saas')
  })

  it('un rând needitat (updated_at = created_at) cu tokeni vechi e resincronizat la canonical la randare', async () => {
    await templatesService.listTemplates()
    await db
      .update(contractTemplates)
      .set({ bodyHtml: staleBody, updatedAt: sql`${contractTemplates.createdAt}` })
      .where(eq(contractTemplates.key, 'contract-saas'))

    const client = await makeCompleteClient()
    await expect(service.generateDocument(client.id, 'contract')).resolves.toBeDefined()
    expect(await templatesService.getTemplateBody('contract-saas')).toBe(CONTRACT_TEMPLATE_BODIES['contract-saas'])
  })

  it('un șablon editat de Stefan NU e suprascris de canonical', async () => {
    const edited = await templatesService.updateTemplate('contract-saas', '<p>Contract {{nrContract}}</p>')
    expect(await templatesService.getTemplateBody('contract-saas')).toBe(edited.bodyHtml)
  })
})
