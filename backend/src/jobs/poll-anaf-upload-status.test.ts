/**
 * Integration test — pg real (test/setup.ts), external calls mocked.
 *
 * pollAnafUploadStatuses() touches three externals we must NOT hit for real in a test:
 * ANAF (checkUploadStatus + the OAuth session), Resend (sendEmail/sendAlertEmail), and
 * Chromium/PDF generation (generateInvoiceDocuments + readDocument). All four are mocked
 * at the module level; financial_records / billing_clients / invoice_line_items are real
 * rows in the dev Postgres (same DB accounting-alerts.test.ts uses), cleaned up after each
 * test. Chosen over a pure-unit test with a hand-rolled DB stub because the job's core
 * risk is the SQL query (`anaf_status='pending'`) selecting/excluding the right rows across
 * reruns — worth exercising against real Postgres, not a mock.
 *
 * Safety: the checkUploadStatus mock defaults to 'pending' for any uploadId it doesn't
 * recognize, so if a real row with anaf_status='pending' ever exists in the dev DB when
 * this runs, it is left untouched (confirmed empty at time of writing, but the fallback
 * makes that not load-bearing).
 */
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnafUploadStatus } from '../connectors/types.js'
import { db } from '../shared/db/client.js'
import { billingClients, financialRecords, invoiceLineItems } from '../shared/db/schema/index.js'
import type { EmailAttachment } from '../shared/lib/email.js'

const checkUploadStatusMock = vi.fn<(session: unknown, uploadId: string) => Promise<AnafUploadStatus>>()
const getAnafSessionMock = vi.fn(async () => ({ accessToken: 'fake-token-for-test' }))
const sendEmailMock = vi
  .fn<(opts: { to: string; subject: string; text: string; attachments?: EmailAttachment[] }) => Promise<void>>()
  .mockResolvedValue(undefined)
const sendAlertEmailMock = vi.fn<(subject: string, body: string) => Promise<void>>().mockResolvedValue(undefined)
const generateInvoiceDocumentsMock =
  vi.fn<(invoiceId: string, input: { documentNumber: string; customer: { name: string } }) => Promise<{ xmlPath: string; pdfPath: string | null }>>()
const readDocumentMock = vi.fn(async () => Buffer.from('%PDF-1.4 mock pdf bytes'))

vi.mock('../connectors/anaf/index.js', () => ({
  anafConnector: { checkUploadStatus: checkUploadStatusMock },
}))
vi.mock('../shared/lib/anaf.js', () => ({ getAnafSession: getAnafSessionMock }))
vi.mock('../shared/lib/email.js', () => ({
  sendEmail: sendEmailMock,
  sendAlertEmail: sendAlertEmailMock,
}))
vi.mock('../shared/lib/documents.js', () => ({ generateInvoiceDocuments: generateInvoiceDocumentsMock }))
vi.mock('../shared/lib/storage.js', () => ({ readDocument: readDocumentMock }))
// Boundary — testat separat în shared/lib/financial-archive.test.ts. Fără mock aici, ar
// lovi R2 real (modules/archive/service.js → uploadToR2).
const archiveInvoiceDocumentsMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../shared/lib/financial-archive.js', () => ({
  archiveInvoiceDocuments: (...args: unknown[]) => archiveInvoiceDocumentsMock(...args),
}))

const { pollAnafUploadStatuses } = await import('./poll-anaf-upload-status.js')

// uploadId -> status, consulted by the checkUploadStatus mock. Reset per test.
const statusByUploadId = new Map<string, AnafUploadStatus>()

beforeEach(() => {
  vi.clearAllMocks()
  statusByUploadId.clear()
  checkUploadStatusMock.mockImplementation(async (_session, uploadId) => statusByUploadId.get(uploadId) ?? 'pending')
  getAnafSessionMock.mockImplementation(async () => ({ accessToken: 'fake-token-for-test' }))
  readDocumentMock.mockImplementation(async () => Buffer.from('%PDF-1.4 mock pdf bytes'))
})

const createdClientIds: string[] = []
const createdRecordIds: string[] = []

async function makeClient(overrides: Partial<typeof billingClients.$inferInsert> = {}) {
  const [row] = await db
    .insert(billingClients)
    .values({
      name: 'QA Sprint A Test Client',
      cif: 'RO00000000',
      address: 'Str. Test nr. 1',
      country: 'RO',
      email: 'qa-client@example.com',
      ...overrides,
    })
    .returning()
  createdClientIds.push(row!.id)
  return row!
}

async function makeRecord(overrides: Partial<typeof financialRecords.$inferInsert> & { anafUploadId: string }) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      amount: '100.00',
      currency: 'RON',
      issuedAt: new Date(),
      source: 'generated',
      anafStatus: 'pending',
      documentNumber: `QA-SPRINT-A-${overrides.anafUploadId}`,
      ...overrides,
    })
    .returning()
  createdRecordIds.push(row!.id)
  return row!
}

async function reloadRecord(id: string) {
  const [row] = await db.select().from(financialRecords).where(eq(financialRecords.id, id))
  return row!
}

afterEach(async () => {
  for (const id of createdRecordIds.splice(0)) {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id))
    await db.delete(financialRecords).where(eq(financialRecords.id, id))
  }
  for (const id of createdClientIds.splice(0)) {
    await db.delete(billingClients).where(eq(billingClients.id, id))
  }
})

afterAll(async () => {
  // Belt-and-suspenders in case an assertion failure short-circuited an afterEach.
  for (const id of createdRecordIds) {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id)).catch(() => {})
    await db.delete(financialRecords).where(eq(financialRecords.id, id)).catch(() => {})
  }
  for (const id of createdClientIds) {
    await db.delete(billingClients).where(eq(billingClients.id, id)).catch(() => {})
  }
})

describe('pollAnafUploadStatuses — validated with PDF already present (happy path)', () => {
  it('sends exactly one email with the existing PDF bytes as attachment, and marks validated', async () => {
    const client = await makeClient()
    const record = await makeRecord({
      anafUploadId: 'happy-1',
      billingClientId: client.id,
      pdfStoragePath: 'invoices/2026/already-there.pdf',
    })
    statusByUploadId.set('happy-1', 'validated')

    await pollAnafUploadStatuses()

    expect(generateInvoiceDocumentsMock).not.toHaveBeenCalled()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0]![0] as { to: string; attachments: Array<{ content: Buffer }> }
    expect(call.to).toBe(client.email)
    expect(call.attachments).toHaveLength(1)
    expect(call.attachments[0]!.content.equals(Buffer.from('%PDF-1.4 mock pdf bytes'))).toBe(true)

    const reloaded = await reloadRecord(record.id)
    expect(reloaded.anafStatus).toBe('validated')

    expect(archiveInvoiceDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'out', pdfStoragePath: 'invoices/2026/already-there.pdf' }),
    )
  })
})

describe('pollAnafUploadStatuses — pdfStoragePath missing', () => {
  it('generates the PDF, persists the new path, then sends the email', async () => {
    const client = await makeClient()
    const record = await makeRecord({
      anafUploadId: 'nopdf-1',
      billingClientId: client.id,
      pdfStoragePath: null,
    })
    statusByUploadId.set('nopdf-1', 'validated')
    generateInvoiceDocumentsMock.mockResolvedValue({
      xmlPath: 'invoices/2026/generated.xml',
      pdfPath: 'invoices/2026/generated.pdf',
    })

    await pollAnafUploadStatuses()

    expect(generateInvoiceDocumentsMock).toHaveBeenCalledTimes(1)
    expect(generateInvoiceDocumentsMock.mock.calls[0]![0]).toBe(record.id)

    const reloaded = await reloadRecord(record.id)
    expect(reloaded.pdfStoragePath).toBe('invoices/2026/generated.pdf')
    expect(reloaded.xmlStoragePath).toBe('invoices/2026/generated.xml')
    expect(reloaded.anafStatus).toBe('validated')

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('passes Romanian diacritics and emoji in client name through untouched to the document builder', async () => {
    const client = await makeClient({ name: 'Ș.C. Țărănașu & Assoc. 🚀 S.R.L.' })
    await makeRecord({
      anafUploadId: 'diacritics-1',
      billingClientId: client.id,
      pdfStoragePath: null,
      description: 'Notă cu diacritice: ăâîșț',
    })
    statusByUploadId.set('diacritics-1', 'validated')
    generateInvoiceDocumentsMock.mockResolvedValue({
      xmlPath: 'invoices/2026/diacritics.xml',
      pdfPath: 'invoices/2026/diacritics.pdf',
    })

    await pollAnafUploadStatuses()

    expect(generateInvoiceDocumentsMock).toHaveBeenCalledTimes(1)
    const input = generateInvoiceDocumentsMock.mock.calls[0]![1]
    expect(input.customer.name).toBe('Ș.C. Țărănașu & Assoc. 🚀 S.R.L.')
  })
})

describe('pollAnafUploadStatuses — billingClientId is null', () => {
  it('skips sendEmail entirely but still marks validated, without crashing', async () => {
    const record = await makeRecord({
      anafUploadId: 'noclient-1',
      billingClientId: null,
      pdfStoragePath: 'invoices/2026/whatever.pdf',
    })
    statusByUploadId.set('noclient-1', 'validated')

    await expect(pollAnafUploadStatuses()).resolves.toBeUndefined()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(generateInvoiceDocumentsMock).not.toHaveBeenCalled()
    const reloaded = await reloadRecord(record.id)
    expect(reloaded.anafStatus).toBe('validated')
  })
})

describe('pollAnafUploadStatuses — client without email', () => {
  it('does not send an email, but still generates the PDF if it was missing', async () => {
    const client = await makeClient({ email: null })
    const record = await makeRecord({
      anafUploadId: 'noemail-1',
      billingClientId: client.id,
      pdfStoragePath: null,
    })
    statusByUploadId.set('noemail-1', 'validated')
    generateInvoiceDocumentsMock.mockResolvedValue({
      xmlPath: 'invoices/2026/noemail.xml',
      pdfPath: 'invoices/2026/noemail.pdf',
    })

    await pollAnafUploadStatuses()

    expect(generateInvoiceDocumentsMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).not.toHaveBeenCalled()
    const reloaded = await reloadRecord(record.id)
    expect(reloaded.pdfStoragePath).toBe('invoices/2026/noemail.pdf')
    expect(reloaded.anafStatus).toBe('validated')
  })
})

describe('pollAnafUploadStatuses — client with a syntactically invalid email', () => {
  it('sends anyway (no format validation in this job) — flagged, not fixed', async () => {
    const client = await makeClient({ email: 'nu-e-email' })
    await makeRecord({
      anafUploadId: 'bademail-1',
      billingClientId: client.id,
      pdfStoragePath: 'invoices/2026/whatever.pdf',
    })
    statusByUploadId.set('bademail-1', 'validated')

    await pollAnafUploadStatuses()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0]![0]).toMatchObject({ to: 'nu-e-email' })
  })
})

describe('pollAnafUploadStatuses — PDF generation throws', () => {
  it('keeps the record validated, sends an internal alert fallback, does not call sendEmail, and continues the loop', async () => {
    const client = await makeClient()
    const failing = await makeRecord({
      anafUploadId: 'pdffail-1',
      billingClientId: client.id,
      pdfStoragePath: null,
    })
    const nextInLoop = await makeRecord({
      anafUploadId: 'pdffail-2-ok',
      billingClientId: client.id,
      pdfStoragePath: 'invoices/2026/already-there.pdf',
    })
    statusByUploadId.set('pdffail-1', 'validated')
    statusByUploadId.set('pdffail-2-ok', 'validated')
    generateInvoiceDocumentsMock.mockImplementation(async (invoiceId: string) => {
      if (invoiceId === failing.id) throw new Error('Chromium crashed (simulated)')
      return { xmlPath: 'x.xml', pdfPath: 'x.pdf' }
    })

    await pollAnafUploadStatuses()

    const reloadedFailing = await reloadRecord(failing.id)
    expect(reloadedFailing.anafStatus).toBe('validated') // no rollback of the status transition
    expect(reloadedFailing.pdfStoragePath).toBeNull() // failed generation did not persist a path

    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1)
    expect(sendAlertEmailMock.mock.calls[0]![0]).toMatch(/generare PDF eșuată/i)

    // The failure on `failing` must not stop the loop from processing the next record.
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0]![0] as { to: string }
    expect(call.to).toBe(client.email)
    const reloadedNext = await reloadRecord(nextInLoop.id)
    expect(reloadedNext.anafStatus).toBe('validated')
  })
})

describe('pollAnafUploadStatuses — rerun / idempotency', () => {
  it('does not re-send email on a second run because the row no longer matches anaf_status=pending', async () => {
    const client = await makeClient()
    await makeRecord({
      anafUploadId: 'rerun-1',
      billingClientId: client.id,
      pdfStoragePath: 'invoices/2026/already-there.pdf',
    })
    statusByUploadId.set('rerun-1', 'validated')

    await pollAnafUploadStatuses()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)

    await pollAnafUploadStatuses()
    // Still exactly 1 — the second run's query excludes the now-'validated' row.
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(checkUploadStatusMock).toHaveBeenCalledTimes(1) // only called once total, in the first run
  })
})

describe('pollAnafUploadStatuses — rejected (regression, pre-existing path)', () => {
  it('sends the rejection alert and does not call sendEmail (the validated-invoice email)', async () => {
    const record = await makeRecord({
      anafUploadId: 'rejected-1',
      pdfStoragePath: null,
    })
    statusByUploadId.set('rejected-1', 'rejected')

    await pollAnafUploadStatuses()

    const reloaded = await reloadRecord(record.id)
    expect(reloaded.anafStatus).toBe('rejected')
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1)
    expect(sendAlertEmailMock.mock.calls[0]![0]).toMatch(/e-Factura respinsă/)
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(generateInvoiceDocumentsMock).not.toHaveBeenCalled()
  })
})

describe('pollAnafUploadStatuses — status still pending', () => {
  it('does not touch the row at all', async () => {
    const record = await makeRecord({ anafUploadId: 'still-pending-1' })
    // No entry in statusByUploadId → mock default 'pending'.

    await pollAnafUploadStatuses()

    const reloaded = await reloadRecord(record.id)
    expect(reloaded.anafStatus).toBe('pending')
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(sendAlertEmailMock).not.toHaveBeenCalled()
  })
})

describe('pollAnafUploadStatuses — deleted (soft) records are excluded', () => {
  it('ignores a soft-deleted pending record even if its uploadId would resolve to validated', async () => {
    const record = await makeRecord({ anafUploadId: 'softdeleted-1', pdfStoragePath: 'x.pdf' })
    await db.update(financialRecords).set({ deletedAt: new Date() }).where(eq(financialRecords.id, record.id))
    statusByUploadId.set('softdeleted-1', 'validated')

    await pollAnafUploadStatuses()

    expect(checkUploadStatusMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
    const [reloaded] = await db
      .select()
      .from(financialRecords)
      .where(and(eq(financialRecords.id, record.id), isNull(financialRecords.deletedAt)))
    expect(reloaded).toBeUndefined()
  })
})
