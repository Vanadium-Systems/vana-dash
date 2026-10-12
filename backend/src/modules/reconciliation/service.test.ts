/**
 * modules/reconciliation/service.ts — `markInvoicePaidManually` (Sprint C, Track B).
 * Integration test, pg real. `maybeExtendSubscription` (vanagreen-extension.ts) is
 * mocked at the module boundary — its own branching/idempotency is covered exhaustively
 * in vanagreen-extension.test.ts; here we only verify markInvoicePaidManually's own
 * contract (validation, payment status update, correct sourceId/source passed through,
 * and — critically — whether the route survives the hook throwing).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { bankAccounts, bankTransactions, billingClients, financialRecords, paymentMatches } from '../../shared/db/schema/index.js'

const maybeExtendMock = vi.fn()
vi.mock('./vanagreen-extension.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./vanagreen-extension.js')>()
  return { ...actual, maybeExtendSubscription: (...args: unknown[]) => maybeExtendMock(...args) }
})

const sendPaymentConfirmationMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../shared/lib/payment-confirmation.js', () => ({
  sendPaymentConfirmationEmail: (...args: unknown[]) => sendPaymentConfirmationMock(...args),
}))

const { createManualMatch, markInvoicePaidManually } = await import('./service.js')

const clientIds: string[] = []
const recordIds: string[] = []
const accountIds: string[] = []
const txnIds: string[] = []

async function makeClient() {
  const [row] = await db
    .insert(billingClients)
    .values({ name: 'MarkPaid QA Client', cif: 'RO55555555', address: 'Str. Test 9' })
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
      paymentStatus: 'unpaid',
      ...overrides,
    })
    .returning()
  recordIds.push(row!.id)
  return row!
}

async function makeAccount() {
  const [row] = await db
    .insert(bankAccounts)
    .values({ provider: 'revolut', name: 'ManualMatch QA account', currency: 'RON' })
    .returning()
  accountIds.push(row!.id)
  return row!
}

async function makeTxn(bankAccountId: string, amount: string) {
  const [row] = await db
    .insert(bankTransactions)
    .values({
      bankAccountId,
      externalId: `manual-match-qa-${Math.random()}`,
      amount,
      currency: 'RON',
      valueDate: new Date(),
      direction: 'in',
    })
    .returning()
  txnIds.push(row!.id)
  return row!
}

beforeEach(() => {
  maybeExtendMock.mockReset()
  maybeExtendMock.mockResolvedValue(undefined)
  sendPaymentConfirmationMock.mockClear()
})

afterEach(async () => {
  if (txnIds.length) {
    await db.delete(paymentMatches).where(inArray(paymentMatches.bankTransactionId, txnIds))
    await db.delete(bankTransactions).where(inArray(bankTransactions.id, txnIds.splice(0)))
  }
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds.splice(0)))
})

afterAll(async () => {
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
  if (accountIds.length) await db.delete(bankAccounts).where(inArray(bankAccounts.id, accountIds))
})

describe('markInvoicePaidManually', () => {
  it('marks the invoice paid and calls maybeExtendSubscription with source:mark_paid and a stable sourceId', async () => {
    const client = await makeClient()
    const invoice = await makeInvoice({ billingClientId: client.id })

    const updated = await markInvoicePaidManually(invoice.id)
    expect(updated?.paymentStatus).toBe('paid')
    expect(updated?.paidAt).not.toBeNull()

    expect(maybeExtendMock).toHaveBeenCalledWith({
      billingClientId: client.id,
      source: 'mark_paid',
      sourceId: `mark-paid:${invoice.id}`,
    })
    expect(sendPaymentConfirmationMock).toHaveBeenCalledWith(invoice.id)
  })

  it('throws when the financial record does not exist', async () => {
    await expect(markInvoicePaidManually('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/nu există/)
    expect(maybeExtendMock).not.toHaveBeenCalled()
  })

  it('throws when the record is direction:in (received invoice, not one we issued)', async () => {
    const invoice = await makeInvoice({ direction: 'in', source: 'anaf_efactura' })
    await expect(markInvoicePaidManually(invoice.id)).rejects.toThrow(/Nu e o factură emisă/)
    expect(maybeExtendMock).not.toHaveBeenCalled()

    const [row] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice.id))
    expect(row?.paymentStatus).toBe('unpaid') // nu s-a modificat nimic dacă validarea a picat
  })

  it('throws when the record is type:expense (not an invoice at all)', async () => {
    const invoice = await makeInvoice({ type: 'expense', direction: 'out' })
    await expect(markInvoicePaidManually(invoice.id)).rejects.toThrow(/Nu e o factură emisă/)
  })

  it('is idempotent-safe when called twice: second call re-marks paid (paidAt refreshed) and hook still called with the SAME sourceId both times — dedup is vanagreen-extension.ts responsibility, not this function', async () => {
    const client = await makeClient()
    const invoice = await makeInvoice({ billingClientId: client.id })

    await markInvoicePaidManually(invoice.id)
    await markInvoicePaidManually(invoice.id)

    expect(maybeExtendMock).toHaveBeenCalledTimes(2)
    expect(maybeExtendMock.mock.calls[0]![0]).toEqual(maybeExtendMock.mock.calls[1]![0])
  })

  it('CRITICAL — isolation (BUG-QA-MARKPAID-1 fixat): if maybeExtendSubscription throws, markInvoicePaidManually still resolves — the primary action (mark paid) succeeds regardless', async () => {
    const client = await makeClient()
    const invoice = await makeInvoice({ billingClientId: client.id })
    maybeExtendMock.mockRejectedValue(new Error('vanagreen down'))

    // Fixat: try/catch în jurul hook-ului — o eroare de extindere vanagreen nu mai
    // face ca acțiunea primară (marcarea facturii ca plătită) să pară eșuată.
    await expect(markInvoicePaidManually(invoice.id)).resolves.toBeDefined()

    const [row] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice.id))
    expect(row?.paymentStatus).toBe('paid')
  })
})

describe('createManualMatch — confirmare de încasare pe email', () => {
  it('sends the payment confirmation when the transaction covers the invoice in full (paid)', async () => {
    const client = await makeClient()
    const account = await makeAccount()
    const invoice = await makeInvoice({ billingClientId: client.id, amount: '100.00' })
    const txn = await makeTxn(account.id, '100.00')

    await createManualMatch(txn.id, invoice.id)

    expect(sendPaymentConfirmationMock).toHaveBeenCalledWith(invoice.id)
  })

  it('does NOT send the payment confirmation for a partial match (misleading to say "we received payment")', async () => {
    const client = await makeClient()
    const account = await makeAccount()
    const invoice = await makeInvoice({ billingClientId: client.id, amount: '100.00' })
    const txn = await makeTxn(account.id, '40.00')

    await createManualMatch(txn.id, invoice.id)

    const [row] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice.id))
    expect(row?.paymentStatus).toBe('partial')
    expect(sendPaymentConfirmationMock).not.toHaveBeenCalled()
  })
})
