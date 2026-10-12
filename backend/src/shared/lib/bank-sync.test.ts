/**
 * shared/lib/bank-sync.ts — `autoMatchTransactions()` + hook-ul nou
 * `maybeExtendSubscription` (Sprint C, Track B). Integration test, pg real
 * (test/setup.ts). Mockuim doar `maybeExtendSubscription` (boundary spre
 * modules/reconciliation/vanagreen-extension.ts, testat separat cu DB real
 * în vanagreen-extension.test.ts) — aici verificăm STRICT contractul cerut
 * de briefing: match-ul bancar nu trebuie să pice dacă hook-ul aruncă.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/client.js'
import {
  bankAccounts,
  bankTransactions,
  billingClients,
  financialRecords,
  paymentMatches,
} from '../db/schema/index.js'

const maybeExtendMock = vi.fn()
vi.mock('../../modules/reconciliation/vanagreen-extension.js', () => ({
  maybeExtendSubscription: (...args: unknown[]) => maybeExtendMock(...args),
}))

const sendPaymentConfirmationMock = vi.fn().mockResolvedValue(undefined)
vi.mock('./payment-confirmation.js', () => ({
  sendPaymentConfirmationEmail: (...args: unknown[]) => sendPaymentConfirmationMock(...args),
}))

const { autoMatchTransactions } = await import('./bank-sync.js')

const accountIds: string[] = []
const clientIds: string[] = []
const txnIds: string[] = []
const recordIds: string[] = []

async function makeAccount() {
  const [row] = await db
    .insert(bankAccounts)
    .values({ provider: 'revolut', name: 'QA test account', currency: 'RON' })
    .returning()
  accountIds.push(row!.id)
  return row!
}

async function makeClient(overrides: Partial<typeof billingClients.$inferInsert> = {}) {
  const [row] = await db
    .insert(billingClients)
    .values({ name: 'BankSync QA Client', cif: 'RO888888', address: 'Str. Test 2', ...overrides })
    .returning()
  clientIds.push(row!.id)
  return row!
}

async function makeInvoice(billingClientId: string, amount: string, documentNumber: string) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      source: 'generated',
      amount,
      currency: 'RON',
      issuedAt: new Date(),
      documentNumber,
      billingClientId,
      paymentStatus: 'unpaid',
    })
    .returning()
  recordIds.push(row!.id)
  return row!
}

async function makeTxn(bankAccountId: string, externalId: string, amount: string, reference: string) {
  const [row] = await db
    .insert(bankTransactions)
    .values({
      bankAccountId,
      externalId,
      amount,
      currency: 'RON',
      reference,
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

describe('autoMatchTransactions — vanagreen extension hook', () => {
  it('calls maybeExtendSubscription with the billingClientId + auto_match source + the payment_match id, after a successful auto-match', async () => {
    const account = await makeAccount()
    const client = await makeClient()
    const invoice = await makeInvoice(client.id, '100.00', 'VAN-2026-0001')
    await makeTxn(account.id, `ext-${invoice.id}`, '100.00', 'plata VAN-2026-0001')

    const matched = await autoMatchTransactions()
    expect(matched).toBe(1)

    expect(maybeExtendMock).toHaveBeenCalledTimes(1)
    const [match] = await db.select().from(paymentMatches).where(eq(paymentMatches.financialRecordId, invoice.id))
    expect(maybeExtendMock).toHaveBeenCalledWith({
      billingClientId: client.id,
      source: 'auto_match',
      sourceId: match!.id,
    })

    const [updated] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice.id))
    expect(updated?.paymentStatus).toBe('paid')
    expect(sendPaymentConfirmationMock).toHaveBeenCalledWith(invoice.id)
  })

  it('CRITICAL (mandatory per qa.agent.md — connector/hook failure isolation, BUG-QA-BANKSYNC-1 fixat): the bank match is NOT rolled back AND autoMatchTransactions resolves normally when maybeExtendSubscription throws', async () => {
    const account = await makeAccount()
    const client = await makeClient()
    const invoice = await makeInvoice(client.id, '250.00', 'VAN-2026-0002')
    await makeTxn(account.id, `ext-${invoice.id}`, '250.00', 'plata VAN-2026-0002')

    maybeExtendMock.mockRejectedValue(new Error('vanagreen-extension boom'))

    // Fixat: try/catch local în jurul apelului la maybeExtendSubscription — o eroare
    // acolo nu mai propagă din autoMatchTransactions (izolare cf. regula #7 CLAUDE.md).
    await expect(autoMatchTransactions()).resolves.toBe(1)

    const [updated] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice.id))
    expect(updated?.paymentStatus).toBe('paid')
    const [match] = await db.select().from(paymentMatches).where(eq(paymentMatches.financialRecordId, invoice.id))
    expect(match).toBeDefined()
  })

  it('BUG-QA-BANKSYNC-2 fixat: when maybeExtendSubscription throws on transaction #1, transaction #2 (later in the same unmatched batch) is still processed', async () => {
    const account = await makeAccount()
    const client = await makeClient()
    const invoice1 = await makeInvoice(client.id, '10.00', 'VAN-2026-0010')
    const invoice2 = await makeInvoice(client.id, '20.00', 'VAN-2026-0011')
    await makeTxn(account.id, `ext-${invoice1.id}`, '10.00', 'plata VAN-2026-0010')
    await makeTxn(account.id, `ext-${invoice2.id}`, '20.00', 'plata VAN-2026-0011')

    maybeExtendMock.mockRejectedValue(new Error('boom on first call'))

    // Fixat: bucla nu mai moare la prima aruncare — ambele tranzacții sunt procesate,
    // matched=2, indiferent că hook-ul a picat pt. fiecare (izolat per-tranzacție).
    await expect(autoMatchTransactions()).resolves.toBe(2)

    const [rec1] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice1.id))
    const [rec2] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice2.id))
    expect(rec1?.paymentStatus).toBe('paid')
    expect(rec2?.paymentStatus).toBe('paid')
  })

  it('sendPaymentConfirmationEmail rejecting does not fail the match or stop the batch (fire-and-forget, .catch inline)', async () => {
    const account = await makeAccount()
    const client = await makeClient()
    const invoice = await makeInvoice(client.id, '30.00', 'VAN-2026-0020')
    await makeTxn(account.id, `ext-${invoice.id}`, '30.00', 'plata VAN-2026-0020')

    sendPaymentConfirmationMock.mockRejectedValue(new Error('resend down'))

    await expect(autoMatchTransactions()).resolves.toBe(1)
    const [updated] = await db.select().from(financialRecords).where(eq(financialRecords.id, invoice.id))
    expect(updated?.paymentStatus).toBe('paid')
  })

  it('is a true no-op when there are zero unmatched incoming transactions (does not call the hook)', async () => {
    await autoMatchTransactions()
    expect(maybeExtendMock).not.toHaveBeenCalled()
  })
})
