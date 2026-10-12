/**
 * shared/lib/payment-confirmation.ts — `sendPaymentConfirmationEmail()`.
 * Integration test, pg real (test/setup.ts). Externals mocked la boundary:
 * `sendEmail` (Resend) și `htmlToPdf`/`isPdfAvailable` (Chromium) — niciodată
 * lovite real într-un test. Sursă unică pt. confirmarea de încasare (NU
 * chitanță — vezi PLAN.md), apelată din reconciliation/service.ts și bank-sync.ts.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/client.js'
import { billingClients, financialRecords } from '../db/schema/index.js'
import type { EmailAttachment } from './email.js'

const sendEmailMock = vi
  .fn<(opts: { to: string; subject: string; text: string; attachments?: EmailAttachment[] }) => Promise<void>>()
  .mockResolvedValue(undefined)
vi.mock('./email.js', () => ({ sendEmail: (...args: unknown[]) => sendEmailMock(...(args as [never])) }))

const isPdfAvailableMock = vi.fn(() => true)
const htmlToPdfMock = vi.fn<(html: string) => Promise<Buffer>>(async () => Buffer.from('%PDF-1.4 mock'))
vi.mock('./pdf.js', () => ({
  isPdfAvailable: () => isPdfAvailableMock(),
  htmlToPdf: (html: string) => htmlToPdfMock(html),
}))

const { sendPaymentConfirmationEmail } = await import('./payment-confirmation.js')

const clientIds: string[] = []
const recordIds: string[] = []

async function makeClient(overrides: Partial<typeof billingClients.$inferInsert> = {}) {
  const [row] = await db
    .insert(billingClients)
    .values({ name: 'PaymentConfirmation QA Client', cif: 'RO77777777', address: 'Str. Test 7', ...overrides })
    .returning()
  clientIds.push(row!.id)
  return row!
}

async function makeInvoice(overrides: Partial<typeof financialRecords.$inferInsert>) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      source: 'generated',
      amount: '100.00',
      currency: 'RON',
      issuedAt: new Date(),
      documentNumber: 'VAN-2026-0099',
      paymentStatus: 'paid',
      paidAt: new Date(),
      ...overrides,
    })
    .returning()
  recordIds.push(row!.id)
  return row!
}

beforeEach(() => {
  sendEmailMock.mockClear()
  isPdfAvailableMock.mockReturnValue(true)
  htmlToPdfMock.mockClear()
})

afterEach(async () => {
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds.splice(0)))
})

afterAll(async () => {
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
})

describe('sendPaymentConfirmationEmail', () => {
  it('sends to the client email with a PDF attachment when Chromium is available', async () => {
    const client = await makeClient({ email: 'client@example.com' })
    const invoice = await makeInvoice({ billingClientId: client.id, amount: '250.50' })

    await sendPaymentConfirmationEmail(invoice.id)

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0]![0]
    expect(call.to).toBe('client@example.com')
    expect(call.subject).toContain('VAN-2026-0099')
    expect(call.text).not.toMatch(/chitanț/i)
    expect(call.attachments).toHaveLength(1)
    expect(call.attachments![0]!.filename).toBe('confirmare-VAN-2026-0099.pdf')
  })

  it('sends without an attachment when Chromium is unavailable, without erroring', async () => {
    isPdfAvailableMock.mockReturnValue(false)
    const client = await makeClient({ email: 'client2@example.com' })
    const invoice = await makeInvoice({ billingClientId: client.id })

    await sendPaymentConfirmationEmail(invoice.id)

    expect(htmlToPdfMock).not.toHaveBeenCalled()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0]![0].attachments).toEqual([])
  })

  it('does not send when the client has no email on file', async () => {
    const client = await makeClient({ email: null })
    const invoice = await makeInvoice({ billingClientId: client.id })

    await sendPaymentConfirmationEmail(invoice.id)

    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('does not send when the invoice has no mapped billing client (manual/legacy invoice)', async () => {
    const invoice = await makeInvoice({ billingClientId: null })

    await sendPaymentConfirmationEmail(invoice.id)

    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('does not send for a received invoice (direction:in)', async () => {
    const client = await makeClient({ email: 'client3@example.com' })
    const invoice = await makeInvoice({ billingClientId: client.id, direction: 'in', source: 'anaf_efactura' })

    await sendPaymentConfirmationEmail(invoice.id)

    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('does not send for a non-invoice record (expense)', async () => {
    const client = await makeClient({ email: 'client4@example.com' })
    const record = await makeInvoice({ billingClientId: client.id, type: 'expense', direction: 'in' })

    await sendPaymentConfirmationEmail(record.id)

    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('is a no-op (does not throw) for a non-existent financial record id', async () => {
    await expect(
      sendPaymentConfirmationEmail('00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
