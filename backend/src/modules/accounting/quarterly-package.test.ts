/**
 * modules/accounting/quarterly-package.ts — integration test, pg real (test/setup.ts).
 * shared/lib/r2.ts mockuit (fără bucket R2 real disponibil în CI/dev), la fel ca
 * modules/archive/service.test.ts — capturăm buffer-ul urcat ca "zip" și îl decodăm cu fflate
 * ca să verificăm conținutul, fără să depindem de un bucket real.
 */
import type { Readable } from 'node:stream'
import { unzipSync } from 'fflate'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { bankAccounts, bankTransactions, financialRecords } from '../../shared/db/schema/index.js'

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

vi.mock('../../shared/lib/r2.js', () => ({
  downloadFromR2: vi.fn().mockResolvedValue(Buffer.from('fake-file-content')),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned-fake'),
  uploadToR2: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../shared/lib/thumbnail.js', () => ({
  generatePdfThumbnail: vi.fn().mockResolvedValue(null),
}))

const { uploadToR2 } = await import('../../shared/lib/r2.js')
const archiveService = await import('../archive/service.js')
const { getQuarterlyPackageSummary, buildQuarterlyPackage, parseQuarter } = await import('./quarterly-package.js')

const recordIds: string[] = []
const bankAccountIds: string[] = []
const bankTxIds: string[] = []

afterAll(async () => {
  if (bankTxIds.length) await db.delete(bankTransactions).where(inArray(bankTransactions.id, bankTxIds))
  if (bankAccountIds.length) await db.delete(bankAccounts).where(inArray(bankAccounts.id, bankAccountIds))
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
})

async function insertRecord(overrides: Partial<typeof financialRecords.$inferInsert>) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      amount: '100.00',
      currency: 'RON',
      issuedAt: new Date('2026-04-10T00:00:00Z'),
      source: 'manual',
      reverseChargeType: 'none',
      ...overrides,
    })
    .returning()
  recordIds.push(row!.id)
  return row!
}

describe('parseQuarter', () => {
  it('maps Q2 to April-June and produces LL-AAAA month folder names', () => {
    const { from, to, monthFolderNames } = parseQuarter('2026-Q2')
    expect(from.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(to.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(monthFolderNames).toEqual(['04-2026', '05-2026', '06-2026'])
  })

  it('rejects a malformed quarter string', () => {
    expect(() => parseQuarter('2026-Q5')).toThrow()
    expect(() => parseQuarter('not-a-quarter')).toThrow()
  })
})

describe('getQuarterlyPackageSummary', () => {
  it('returns zeros for a quarter with no data', async () => {
    const summary = await getQuarterlyPackageSummary('2020-Q1')
    expect(summary).toMatchObject({
      invoicesIssued: 0,
      invoicesReceived: 0,
      revenueRon: 0,
      expensesRon: 0,
      unmatchedBankTransactions: 0,
      reverseChargeLines: 0,
    })
  })

  it('counts issued/received invoices, revenue/expenses in RON, and reverse-charge lines', async () => {
    await insertRecord({ type: 'invoice', direction: 'out', amount: '1000.00', issuedAt: new Date('2026-04-05T00:00:00Z') })
    await insertRecord({ type: 'invoice', direction: 'in', amount: '200.00', issuedAt: new Date('2026-05-05T00:00:00Z') })
    await insertRecord({
      type: 'expense',
      direction: 'in',
      amount: '50.00',
      reverseChargeType: 'eu_services',
      issuedAt: new Date('2026-06-05T00:00:00Z'),
    })
    // outside the quarter — must not be counted
    await insertRecord({ type: 'invoice', direction: 'out', amount: '9999.00', issuedAt: new Date('2026-07-05T00:00:00Z') })

    const summary = await getQuarterlyPackageSummary('2026-Q2')
    expect(summary.invoicesIssued).toBe(1)
    expect(summary.invoicesReceived).toBe(1)
    expect(summary.revenueRon).toBeCloseTo(1000)
    expect(summary.expensesRon).toBeCloseTo(250)
    expect(summary.reverseChargeLines).toBe(1)
  })

  it('counts bank transactions with no payment_matches row as unmatched', async () => {
    // Trimestru izolat (2015), ca să nu se lovească de date reale seed-uite/sincronizate în DB-ul
    // de dev pt. trimestrele curente.
    const [account] = await db
      .insert(bankAccounts)
      .values({ provider: 'revolut', name: 'Test account', currency: 'RON' })
      .returning()
    bankAccountIds.push(account!.id)
    const [tx] = await db
      .insert(bankTransactions)
      .values({
        bankAccountId: account!.id,
        externalId: `qa-${Date.now()}`,
        amount: '75.00',
        currency: 'RON',
        valueDate: new Date('2015-08-10T00:00:00Z'),
        direction: 'in',
      })
      .returning()
    bankTxIds.push(tx!.id)

    const summary = await getQuarterlyPackageSummary('2015-Q3')
    expect(summary.unmatchedBankTransactions).toBe(1)
  })
})

describe('buildQuarterlyPackage', () => {
  it('uploads a zip containing at least sumar.csv, even with no archived files', async () => {
    const result = await buildQuarterlyPackage('2020-Q1')
    expect(result.zipR2Key).toBe('quarterly-packages/2020-Q1.zip')
    expect(result.downloadUrl).toContain('presigned-fake')

    expect(uploadToR2).toHaveBeenCalled()
    const [, uploadedBody] = vi.mocked(uploadToR2).mock.calls.at(-1)!
    const buffer = await streamToBuffer(uploadedBody as Readable)
    const unzipped = unzipSync(new Uint8Array(buffer))
    expect(Object.keys(unzipped)).toContain('sumar.csv')
    const csvText = new TextDecoder().decode(unzipped['sumar.csv'])
    expect(csvText).toContain('2020-Q1')
  })

  it('includes archived files from the matching months, prefixed with the month folder', async () => {
    // Rădăcina explicită de la caller (jobul scrie în spațiul ales de om, nu într-o rădăcină comună).
    const rootId = await archiveService.systemArchiveRoot()
    const folderId = await archiveService.ensureFolderPath(rootId, ['Contabilitate', '04-2026', 'Facturi clienti', 'Test SRL'])
    await archiveService.uploadSystemFile({ folderId, name: 'FACT-001.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') })

    const result = await buildQuarterlyPackage('2026-Q2')
    const [, uploadedBody] = vi.mocked(uploadToR2).mock.calls.at(-1)!
    const buffer = await streamToBuffer(uploadedBody as Readable)
    const unzipped = unzipSync(new Uint8Array(buffer))
    expect(Object.keys(unzipped)).toContain('04-2026/Facturi clienti/Test SRL/FACT-001.pdf')
    expect(result.summary.quarter).toBe('2026-Q2')
  })
})
