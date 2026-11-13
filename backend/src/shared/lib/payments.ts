import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { financialRecords, invoicePayments, paymentMatches } from '../db/schema/index.js'
import { createdByUserId, recordAudit } from './audit.js'
import { getCompanyTimeZone } from './company.js'
import { qualified } from './sql-fx.js'
import { tr } from './i18n.js'
import type { DrizzleTx } from './sequences.js'

// The only place that writes invoice_payments and, through recalculatePaymentStatus, the
// payment_status / paid_at of a document. Reconciliation (manual and automatic) and the payment
// routes all come through here, so a status can no longer disagree with the payments behind it.

export type Payment = typeof invoicePayments.$inferSelect
export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type PaymentMethod = Payment['method']

export class PaymentError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface PaymentInput {
  amount: number
  /** Defaults to the document's currency; anything else is rejected. */
  currency?: string
  /** A Date is read as a calendar day in the company's time zone. */
  paidAt: string | Date
  method: PaymentMethod
  reference?: string | null
  note?: string | null
  bankTransactionId?: string | null
}

export interface AddPaymentOptions {
  tx?: DrizzleTx
  /** Pay min(amount, remaining) instead of rejecting an amount above the remaining balance. */
  capAtRemaining?: boolean
}

export type AddedPayment = Payment & { paymentStatus: PaymentStatus; becamePaid: boolean }

// Amounts are compared in whole cents: numeric columns come back as strings and a float
// subtraction would turn 0.10 + 0.20 into 0.30000000000000004.
const TOLERANCE_CENTS = 1
const toCents = (value: string | number) => Math.round(Number(value) * 100)
const fromCents = (cents: number) => (cents / 100).toFixed(2)

/**
 * A draft is an invoice, storno or proforma made here and not yet numbered. An issued document
 * added by hand to the archive may have no number of ours either, and it is not a draft.
 */
export const isDraftSql = sql<boolean>`(${financialRecords.source} = 'generated' AND ${financialRecords.documentNumber} IS NULL)`
export const isDraftRecord = (record: { source: string; documentNumber: string | null }) =>
  record.source === 'generated' && !record.documentNumber

/** Sum of the live payments of the record under comparison; for list queries. */
export const paidAmountSql = sql<string>`COALESCE((SELECT SUM(p.amount) FROM ${invoicePayments} p WHERE p.record_id = ${qualified(financialRecords.id)} AND p.deleted_at IS NULL), 0)`

/** Absolute value of the numbered, undeleted storno invoices that correct the record under comparison. */
export const stornoAmountSql = sql<string>`COALESCE((SELECT SUM(-s.amount) FROM financial_records s WHERE s.corrects_record_id = ${qualified(financialRecords.id)} AND s.deleted_at IS NULL AND s.document_number IS NOT NULL), 0)`

/**
 * What is still owed, for list queries: the amount minus payments minus numbered stornos. A record
 * already marked paid has no payment rows when it predates payments or was set through the
 * received-documents route, so its status wins. A proforma owes nothing.
 */
export const remainingSql = sql<string>`CASE WHEN ${financialRecords.paymentStatus} = 'paid' OR ${financialRecords.type} = 'proforma' THEN 0 ELSE GREATEST(${financialRecords.amount} - ${paidAmountSql} - ${stornoAmountSql}, 0) END`

/** A calendar day (YYYY-MM-DD) in the given time zone. */
export function dayInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date)
}

type Runner<T> = (tx: DrizzleTx) => Promise<T>
const inTransaction = <T>(tx: DrizzleTx | undefined, run: Runner<T>): Promise<T> => (tx ? run(tx) : db.transaction(run))

async function lockRecord(tx: DrizzleTx, recordId: string) {
  const [record] = await tx
    .select({
      id: financialRecords.id,
      type: financialRecords.type,
      direction: financialRecords.direction,
      amount: financialRecords.amount,
      currency: financialRecords.currency,
      documentNumber: financialRecords.documentNumber,
      source: financialRecords.source,
      paymentStatus: financialRecords.paymentStatus,
      correctsRecordId: financialRecords.correctsRecordId,
    })
    .from(financialRecords)
    .where(and(eq(financialRecords.id, recordId), isNull(financialRecords.deletedAt)))
    .for('update')
  if (!record) throw new PaymentError(404, 'RECORD_NOT_FOUND', tr('errors.payments.recordNotFound'))
  return record
}
type LockedRecord = Awaited<ReturnType<typeof lockRecord>>

async function settlement(tx: DrizzleTx, record: LockedRecord) {
  const [row] = await tx
    .select({ total: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)::text` })
    .from(invoicePayments)
    .where(and(eq(invoicePayments.recordId, record.id), isNull(invoicePayments.deletedAt)))
  const paidCents = toCents(row?.total ?? 0)
  // A numbered storno reduces what is owed the same way a payment does, but it is not money received.
  const [storno] = await tx
    .select({ total: sql<string>`COALESCE(SUM(-${financialRecords.amount}), 0)::text` })
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.correctsRecordId, record.id),
        isNull(financialRecords.deletedAt),
        isNotNull(financialRecords.documentNumber),
      ),
    )
  return { paidCents, remainingCents: toCents(record.amount) - paidCents - toCents(storno?.total ?? 0) }
}

function statusFor(paidCents: number, remainingCents: number): PaymentStatus {
  if (paidCents <= 0) return 'unpaid'
  return remainingCents <= TOLERANCE_CENTS ? 'paid' : 'partial'
}

/** The one place payment_status and paid_at are derived from the payments. */
export async function recalculatePaymentStatus(recordId: string, tx: DrizzleTx): Promise<PaymentStatus> {
  const record = await lockRecord(tx, recordId)
  const { paidCents, remainingCents } = await settlement(tx, record)
  const status = statusFor(paidCents, remainingCents)
  const timeZone = await getCompanyTimeZone()
  // paid_at is a calendar day on the payment and an instant on the document: midnight in the company's zone.
  await tx.execute(sql`
    UPDATE financial_records SET
      payment_status = ${status},
      paid_at = ${
        status === 'paid'
          ? sql`(SELECT MAX(p.paid_at)::timestamp AT TIME ZONE ${timeZone} FROM invoice_payments p WHERE p.record_id = ${recordId} AND p.deleted_at IS NULL)`
          : null
      },
      updated_at = now()
    WHERE id = ${recordId}`)
  return status
}

function auditEntityType(record: LockedRecord) {
  return record.direction === 'out' ? 'invoice' : 'financial_record'
}

export async function addPayment(recordId: string, input: PaymentInput, options: AddPaymentOptions = {}): Promise<AddedPayment> {
  return inTransaction(options.tx, async (tx) => {
    const record = await lockRecord(tx, recordId)
    if (record.type === 'proforma' || record.correctsRecordId) throw new PaymentError(409, 'NOT_PAYABLE', tr('errors.payments.notPayable'))
    if (isDraftRecord(record)) {
      throw new PaymentError(409, 'DRAFT_NOT_PAYABLE', tr('errors.payments.draftNotPayable'))
    }
    if (input.currency && input.currency !== record.currency) {
      throw new PaymentError(400, 'CURRENCY_MISMATCH', tr('errors.payments.currencyMismatch', { currency: input.currency, expected: record.currency }))
    }

    const { remainingCents } = await settlement(tx, record)
    let amountCents = toCents(input.amount)
    if (options.capAtRemaining) {
      if (remainingCents <= TOLERANCE_CENTS) throw new PaymentError(409, 'ALREADY_PAID', tr('errors.payments.alreadyPaid'))
      amountCents = Math.min(amountCents, remainingCents)
    } else if (amountCents > remainingCents + TOLERANCE_CENTS) {
      throw new PaymentError(
        400,
        'OVERPAYMENT',
        tr('errors.payments.overpayment', { remaining: fromCents(Math.max(remainingCents, 0)), currency: record.currency }),
      )
    }

    const paidAt = input.paidAt instanceof Date ? dayInTimeZone(input.paidAt, await getCompanyTimeZone()) : input.paidAt
    const [payment] = await tx
      .insert(invoicePayments)
      .values({
        ...createdByUserId(),
        recordId,
        amount: fromCents(amountCents),
        currency: record.currency,
        paidAt,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        bankTransactionId: input.bankTransactionId ?? null,
      })
      .returning()
    if (!payment) throw new Error('invoice_payments insert returned no row')

    const paymentStatus = await recalculatePaymentStatus(recordId, tx)
    await recordAudit({
      executor: tx,
      action: 'factura.plata.adaugata',
      entityType: auditEntityType(record),
      entityId: recordId,
      changes: {
        suma: [null, `${payment.amount} ${record.currency}`],
        data: [null, paidAt],
        metoda: [null, input.method],
        stare: [record.paymentStatus, paymentStatus],
      },
    })
    return { ...payment, paymentStatus, becamePaid: record.paymentStatus !== 'paid' && paymentStatus === 'paid' }
  })
}

/** Soft delete. `recordId` makes a payment of another document answer 404. */
export async function removePayment(
  paymentId: string,
  options: { recordId?: string; tx?: DrizzleTx } = {},
): Promise<{ paymentStatus: PaymentStatus }> {
  return inTransaction(options.tx, async (tx) => {
    const [found] = await tx
      .select({ recordId: invoicePayments.recordId })
      .from(invoicePayments)
      .where(and(eq(invoicePayments.id, paymentId), isNull(invoicePayments.deletedAt)))
    if (!found || (options.recordId && found.recordId !== options.recordId)) {
      throw new PaymentError(404, 'PAYMENT_NOT_FOUND', tr('errors.payments.paymentNotFound'))
    }
    const record = await lockRecord(tx, found.recordId)

    const [removed] = await tx
      .update(invoicePayments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoicePayments.id, paymentId), isNull(invoicePayments.deletedAt)))
      .returning()
    if (!removed) throw new PaymentError(404, 'PAYMENT_NOT_FOUND', tr('errors.payments.paymentNotFound'))
    // A bank transaction matched only through this payment must show as unmatched again.
    await tx
      .update(paymentMatches)
      .set({ deletedAt: new Date() })
      .where(and(eq(paymentMatches.paymentId, paymentId), isNull(paymentMatches.deletedAt)))

    const paymentStatus = await recalculatePaymentStatus(record.id, tx)
    await recordAudit({
      executor: tx,
      action: 'factura.plata.stearsa',
      entityType: auditEntityType(record),
      entityId: record.id,
      changes: {
        suma: [`${removed.amount} ${record.currency}`, null],
        data: [removed.paidAt, null],
        stare: [record.paymentStatus, paymentStatus],
      },
    })
    return { paymentStatus }
  })
}
