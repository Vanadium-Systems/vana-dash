/**
 * shared/lib/payments.ts: the only writer of invoice_payments and of payment_status / paid_at.
 * Integration test, pg real (test/setup.ts).
 */
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanup, makeBankTxn, makeClient, makeDraftRow, makeIssued } from './invoicing-fixtures.js'
import { db } from '../src/shared/db/client.js'
import { auditLog, financialRecords, invoicePayments, paymentMatches } from '../src/shared/db/schema/index.js'
import { addPayment, PaymentError, removePayment } from '../src/shared/lib/payments.js'

afterAll(cleanup)

const today = '2026-11-12'
const cash = (amount: number, extra: Record<string, unknown> = {}) => ({ amount, paidAt: today, method: 'cash' as const, ...extra })

async function statusOf(id: string) {
  const [row] = await db.select().from(financialRecords).where(eq(financialRecords.id, id))
  return row!
}

describe('addPayment', () => {
  it('refuses a draft: 409 DRAFT_NOT_PAYABLE, nothing written', async () => {
    const draft = await makeDraftRow()
    await expect(addPayment(draft.id, cash(10))).rejects.toMatchObject({ statusCode: 409, code: 'DRAFT_NOT_PAYABLE' })
    expect(await db.select().from(invoicePayments).where(eq(invoicePayments.recordId, draft.id))).toHaveLength(0)
  })

  it('accepts an issued invoice added by hand to the archive without a number: it is not a draft', async () => {
    const archived = await makeIssued({ source: 'manual', documentNumber: null, anafStatus: null })
    const payment = await addPayment(archived.id, cash(100))
    expect(payment.paymentStatus).toBe('paid')
  })

  it('refuses a proforma and a storno: 409 NOT_PAYABLE', async () => {
    const client = await makeClient()
    const proforma = await makeIssued({ type: 'proforma', anafStatus: null, proformaStatus: 'open', billingClientId: client.id })
    await expect(addPayment(proforma.id, cash(10))).rejects.toMatchObject({ statusCode: 409, code: 'NOT_PAYABLE' })

    const original = await makeIssued({ amount: '100.00' })
    const storno = await makeIssued({ amount: '-100.00', correctsRecordId: original.id })
    await expect(addPayment(storno.id, cash(10))).rejects.toMatchObject({ statusCode: 409, code: 'NOT_PAYABLE' })
  })

  it('a partial payment plus a second one makes it paid, with paid_at set', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    const first = await addPayment(invoice.id, cash(40))
    expect(first.paymentStatus).toBe('partial')
    expect(first.becamePaid).toBe(false)
    expect((await statusOf(invoice.id)).paidAt).toBeNull()

    const second = await addPayment(invoice.id, cash(60))
    expect(second.paymentStatus).toBe('paid')
    expect(second.becamePaid).toBe(true)
    const row = await statusOf(invoice.id)
    expect(row.paymentStatus).toBe('paid')
    expect(row.paidAt).not.toBeNull()
  })

  it('deleting one of two payments brings the invoice back to partial, deleting both to unpaid', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    const first = await addPayment(invoice.id, cash(40))
    const second = await addPayment(invoice.id, cash(60))
    expect((await statusOf(invoice.id)).paymentStatus).toBe('paid')

    expect(await removePayment(second.id)).toEqual({ paymentStatus: 'partial' })
    const afterOne = await statusOf(invoice.id)
    expect(afterOne.paymentStatus).toBe('partial')
    expect(afterOne.paidAt).toBeNull()

    expect(await removePayment(first.id)).toEqual({ paymentStatus: 'unpaid' })
    expect((await statusOf(invoice.id)).paymentStatus).toBe('unpaid')
  })

  it('rejects an amount above the remaining balance: 400 OVERPAYMENT, and accepts one cent over', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    await addPayment(invoice.id, cash(70))
    await expect(addPayment(invoice.id, cash(30.5))).rejects.toMatchObject({ statusCode: 400, code: 'OVERPAYMENT' })
    await expect(addPayment(invoice.id, cash(31))).rejects.toBeInstanceOf(PaymentError)
    const ok = await addPayment(invoice.id, cash(30.01))
    expect(ok.paymentStatus).toBe('paid')
  })

  it('two simultaneous payments cannot both take the whole balance', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    const results = await Promise.allSettled([addPayment(invoice.id, cash(60)), addPayment(invoice.id, cash(60))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'OVERPAYMENT' })
    const live = await db.select().from(invoicePayments).where(eq(invoicePayments.recordId, invoice.id))
    expect(live).toHaveLength(1)
  })

  it('rejects another currency: 400 CURRENCY_MISMATCH', async () => {
    const invoice = await makeIssued({ amount: '100.00', currency: 'RON' })
    await expect(addPayment(invoice.id, cash(10, { currency: 'EUR' }))).rejects.toMatchObject({ statusCode: 400, code: 'CURRENCY_MISMATCH' })
  })

  it('capAtRemaining pays min(amount, remaining) and answers ALREADY_PAID when nothing is left', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    await addPayment(invoice.id, cash(80))
    const capped = await addPayment(invoice.id, cash(500), { capAtRemaining: true })
    expect(capped.amount).toBe('20.00')
    expect(capped.paymentStatus).toBe('paid')
    await expect(addPayment(invoice.id, cash(5), { capAtRemaining: true })).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_PAID' })
  })

  it('a numbered storno lowers the balance: 100 - 40 storno - 60 paid = paid', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    await makeIssued({ amount: '-40.00', correctsRecordId: invoice.id, documentNumber: 'QAT-STORNO-' + invoice.id.slice(0, 6) })
    // 70 would be an overpayment against the 60 still owed.
    await expect(addPayment(invoice.id, cash(70))).rejects.toMatchObject({ code: 'OVERPAYMENT' })
    const payment = await addPayment(invoice.id, cash(60))
    expect(payment.paymentStatus).toBe('paid')
  })

  it('a storno draft (no number) does not lower the balance', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    await makeDraftRow({ amount: '-40.00', correctsRecordId: invoice.id })
    const payment = await addPayment(invoice.id, cash(100))
    expect(payment.paymentStatus).toBe('paid')
  })

  it('a received document (no number of ours) can be paid', async () => {
    const received = await makeIssued({ direction: 'in', documentNumber: null, source: 'anaf_efactura', anafStatus: null, amount: '50.00' })
    const payment = await addPayment(received.id, cash(50))
    expect(payment.paymentStatus).toBe('paid')
  })

  it('writes one audit row per payment and per removal, with the state change', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    const payment = await addPayment(invoice.id, cash(100))
    await removePayment(payment.id)
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entityId, invoice.id), eq(auditLog.entityType, 'invoice')))
    const added = rows.filter((r) => r.action === 'factura.plata.adaugata')
    const removed = rows.filter((r) => r.action === 'factura.plata.stearsa')
    expect(added).toHaveLength(1)
    expect(removed).toHaveLength(1)
    expect(added[0]!.changes).toMatchObject({ stare: ['unpaid', 'paid'], metoda: [null, 'cash'] })
    expect(removed[0]!.changes).toMatchObject({ stare: ['paid', 'unpaid'] })
  })
})

describe('removePayment', () => {
  it('answers 404 for a payment of another document or an already removed one', async () => {
    const one = await makeIssued({ amount: '100.00' })
    const other = await makeIssued({ amount: '100.00' })
    const payment = await addPayment(one.id, cash(10))
    await expect(removePayment(payment.id, { recordId: other.id })).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' })
    await removePayment(payment.id)
    await expect(removePayment(payment.id)).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' })
  })

  it('closes the bank match of the payment: payment_matches.deleted_at is set', async () => {
    const invoice = await makeIssued({ amount: '100.00' })
    const txn = await makeBankTxn('100.00')
    const payment = await addPayment(invoice.id, { amount: 100, paidAt: today, method: 'bank', bankTransactionId: txn.id })
    const [match] = await db
      .insert(paymentMatches)
      .values({ bankTransactionId: txn.id, financialRecordId: invoice.id, paymentId: payment.id, matchType: 'manual' })
      .returning()
    expect(match!.deletedAt).toBeNull()

    await removePayment(payment.id)
    const [closed] = await db.select().from(paymentMatches).where(eq(paymentMatches.id, match!.id))
    expect(closed!.deletedAt).not.toBeNull()
  })
})
