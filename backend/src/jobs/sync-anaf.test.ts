/**
 * Integration test — pg real (test/setup.ts), ANAF + storage mocked.
 *
 * Grija principală semnalată de Stefan: rularea repetată a sync-ului (butonul „Sync ANAF
 * acum" apăsat de mai multe ori, sau cronul orar peste o fereastră care se suprapune cu
 * precedenta) NU trebuie să dubleze facturile deja existente în financial_records — nici
 * pe cele primite (dedup pe anaf_message_id), nici pe cele emise (dedup pe document_number,
 * inclusiv când factura a fost deja emisă local prin vana-dash — sursa locală rămâne
 * autoritativă pt. sumă/contraparte, sync-ul doar atașează metadata ANAF).
 */
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnafInvoiceDocument } from '../connectors/types.js'
import { db } from '../shared/db/client.js'
import { financialRecords, syncLog } from '../shared/db/schema/index.js'

const fetchIncomingInvoicesMock = vi.fn<() => Promise<AnafInvoiceDocument[]>>()
const fetchOutgoingInvoicesMock = vi.fn<() => Promise<AnafInvoiceDocument[]>>()
const getAnafCredentialsRowMock = vi.fn(async () => ({ id: 'cred-1', cif: '12345674', status: 'active' as const }))
const getAnafSessionMock = vi.fn(async () => ({ cif: '12345674', accessToken: 'fake-token-for-test' }))
const saveDocumentMock = vi.fn(async (relativePath: string) => `storage/${relativePath}`)
// Boundary — testat separat în shared/lib/financial-archive.test.ts. Fără mock aici, ar
// lovi R2 real (modules/archive/service.js → uploadToR2) la fiecare test din fișierul ăsta.
const archiveInvoiceDocumentsMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../connectors/anaf/index.js', () => ({
  anafConnector: {
    fetchIncomingInvoices: fetchIncomingInvoicesMock,
    fetchOutgoingInvoices: fetchOutgoingInvoicesMock,
  },
}))
vi.mock('../shared/lib/anaf.js', () => ({
  getAnafCredentialsRow: getAnafCredentialsRowMock,
  getAnafSession: getAnafSessionMock,
}))
vi.mock('../shared/lib/storage.js', () => ({ saveDocument: saveDocumentMock }))
vi.mock('../shared/lib/financial-archive.js', () => ({
  archiveInvoiceDocuments: (...args: unknown[]) => archiveInvoiceDocumentsMock(...args),
}))

const { triggerAnafSyncNow } = await import('./sync-anaf.js')

function makeDoc(overrides: Partial<AnafInvoiceDocument> = {}): AnafInvoiceDocument {
  return {
    anafMessageId: `msg-${Math.random().toString(36).slice(2)}`,
    documentNumber: null,
    counterpartyName: 'Contraparte Test SRL',
    counterpartyCif: '11223344',
    amount: 100,
    currency: 'RON',
    issuedAt: new Date('2026-07-01T00:00:00Z'),
    dueAt: null,
    xml: '<Invoice/>',
    pdf: null,
    ...overrides,
  }
}

const createdRecordIds: string[] = []

async function findByAnafMessageId(anafMessageId: string) {
  return db.select().from(financialRecords).where(eq(financialRecords.anafMessageId, anafMessageId))
}

async function findByDocumentNumber(documentNumber: string) {
  return db.select().from(financialRecords).where(eq(financialRecords.documentNumber, documentNumber))
}

beforeEach(() => {
  vi.clearAllMocks()
  getAnafCredentialsRowMock.mockResolvedValue({ id: 'cred-1', cif: '12345674', status: 'active' })
  getAnafSessionMock.mockResolvedValue({ cif: '12345674', accessToken: 'fake-token-for-test' })
  saveDocumentMock.mockImplementation(async (relativePath: string) => `storage/${relativePath}`)
  fetchIncomingInvoicesMock.mockResolvedValue([])
  fetchOutgoingInvoicesMock.mockResolvedValue([])
})

afterEach(async () => {
  for (const id of createdRecordIds.splice(0)) {
    await db.delete(financialRecords).where(eq(financialRecords.id, id)).catch(() => {})
  }
  await db.delete(syncLog).where(eq(syncLog.jobKey, 'anaf:12345674')).catch(() => {})
})

afterAll(async () => {
  for (const id of createdRecordIds) {
    await db.delete(financialRecords).where(eq(financialRecords.id, id)).catch(() => {})
  }
})

describe('sync-anaf — facturi primite', () => {
  it('rularea repetată a aceluiași mesaj NU dublează rândul (dedup pe anaf_message_id)', async () => {
    const doc = makeDoc({ anafMessageId: 'incoming-dedup-1', amount: 200 })
    fetchIncomingInvoicesMock.mockResolvedValue([doc])

    await triggerAnafSyncNow()
    await triggerAnafSyncNow()

    const rows = await findByAnafMessageId('incoming-dedup-1')
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.amount)).toBe(200)
    createdRecordIds.push(rows[0]!.id)
  })

  it('arhivează factura primită (direction=\'in\') după fiecare import reușit', async () => {
    const doc = makeDoc({ anafMessageId: 'incoming-archive-1', documentNumber: 'FURN-001' })
    fetchIncomingInvoicesMock.mockResolvedValue([doc])

    await triggerAnafSyncNow()

    expect(archiveInvoiceDocumentsMock).toHaveBeenCalledWith(expect.objectContaining({ direction: 'in', documentNumber: 'FURN-001' }))
    const rows = await findByAnafMessageId('incoming-archive-1')
    createdRecordIds.push(rows[0]!.id)
  })
})

describe('sync-anaf — facturi emise', () => {
  it('dacă factura există deja local (emisă prin vana-dash), sync-ul NU o duplică — doar atașează metadata ANAF', async () => {
    const [local] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'out',
        source: 'generated',
        amount: '999.99',
        currency: 'RON',
        issuedAt: new Date('2026-07-05T00:00:00Z'),
        documentNumber: 'VAN-2026-DEDUP-1',
        counterpartyName: 'Client Local SRL',
      })
      .returning()
    createdRecordIds.push(local!.id)

    // ANAF întoarce ACEEAȘI factură (același număr), cu o sumă diferită — dacă sync-ul ar
    // suprascrie, am prinde regresia aici.
    fetchOutgoingInvoicesMock.mockResolvedValue([
      makeDoc({
        anafMessageId: 'outgoing-dedup-1',
        documentNumber: 'VAN-2026-DEDUP-1',
        amount: 1.0,
        counterpartyName: 'Nume Diferit SRL',
      }),
    ])

    await triggerAnafSyncNow()

    const rows = await findByDocumentNumber('VAN-2026-DEDUP-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.source).toBe('generated')
    expect(Number(rows[0]!.amount)).toBe(999.99) // sursa locală rămâne autoritativă
    expect(rows[0]!.counterpartyName).toBe('Client Local SRL')
    expect(rows[0]!.anafMessageId).toBe('outgoing-dedup-1') // metadata ANAF s-a atașat
    expect(rows[0]!.anafStatus).toBe('validated')
  })

  it('factură emisă istoric (nu prin vana-dash) creează un rând nou, source=anaf_efactura', async () => {
    fetchOutgoingInvoicesMock.mockResolvedValue([
      makeDoc({ anafMessageId: 'outgoing-new-1', documentNumber: 'EXT-2026-0007', amount: 50 }),
    ])

    await triggerAnafSyncNow()

    const rows = await findByDocumentNumber('EXT-2026-0007')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.source).toBe('anaf_efactura')
    expect(rows[0]!.direction).toBe('out')
    createdRecordIds.push(rows[0]!.id)
  })

  it('re-sincronizarea aceleiași facturi emise NU dublează rândul (dedup pe document_number)', async () => {
    const doc = makeDoc({ anafMessageId: 'outgoing-dedup-2', documentNumber: 'EXT-2026-0008', amount: 75 })
    fetchOutgoingInvoicesMock.mockResolvedValue([doc])

    await triggerAnafSyncNow()
    await triggerAnafSyncNow()

    const rows = await findByDocumentNumber('EXT-2026-0008')
    expect(rows).toHaveLength(1)
    createdRecordIds.push(rows[0]!.id)
  })

  it('o factură emisă fără număr de document e ignorată, nu blochează restul sync-ului', async () => {
    fetchOutgoingInvoicesMock.mockResolvedValue([
      makeDoc({ anafMessageId: 'outgoing-no-number', documentNumber: null }),
      makeDoc({ anafMessageId: 'outgoing-with-number', documentNumber: 'EXT-2026-0009', amount: 10 }),
    ])

    const result = await triggerAnafSyncNow()

    expect(result.imported).toBe(1)
    const rows = await findByDocumentNumber('EXT-2026-0009')
    expect(rows).toHaveLength(1)
    createdRecordIds.push(rows[0]!.id)
    const noNumberRows = await findByAnafMessageId('outgoing-no-number')
    expect(noNumberRows).toHaveLength(0)
  })

  it('arhivează factura emisă (direction=\'out\') cu PDF-ul ANAF ca a treia copie separată', async () => {
    fetchOutgoingInvoicesMock.mockResolvedValue([
      makeDoc({
        anafMessageId: 'outgoing-archive-1',
        documentNumber: 'EXT-2026-ARCHIVE',
        amount: 20,
        pdf: Buffer.from('%PDF-fake-anaf-render'),
      }),
    ])

    await triggerAnafSyncNow()

    expect(archiveInvoiceDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'out', documentNumber: 'EXT-2026-ARCHIVE', anafPdfStoragePath: expect.any(String) }),
    )
    const rows = await findByDocumentNumber('EXT-2026-ARCHIVE')
    createdRecordIds.push(rows[0]!.id)
  })
})
