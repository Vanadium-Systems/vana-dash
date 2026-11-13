import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { computeTotals } from '../../connectors/anaf/xml-builder.js'
import { db } from '../../shared/db/client.js'
import { financialRecords, invoiceLineItems, invoicePayments, users } from '../../shared/db/schema/index.js'
import { listEntityHistory } from '../../shared/lib/audit.js'
import { isDraftSql, paidAmountSql, remainingSql } from '../../shared/lib/payments.js'
import { recordColumns, toPublicRow } from './service.js'

// Everything the document page shows, in one round trip. Money is read from the database as
// numeric strings and turned into numbers here, once.

export interface TimelineEntry {
  at: Date
  /** The audit action (`factura.emitata`), or `record.created` for a record with no creation entry. */
  kind: string
  actor: { id: string; name: string | null } | null
  detail: Record<string, unknown> | null
}

const HISTORY_ENTITY_TYPES = ['invoice', 'financial_record']

// A payment appears in the timeline from the payments table, not from its audit row, so payments
// made before audit existed are there too. Its removal still comes from the audit log.
const PAYMENT_ADDED = 'factura.plata.adaugata'

async function sameClientTotals(record: {
  id: string
  direction: 'in' | 'out'
  currency: string
  billingClientId: string | null
  counterpartyCif: string | null
  counterpartyName: string | null
}) {
  // The partner is the billing client on issued invoices, the tax id (else the name) on received ones.
  const partner = record.billingClientId
    ? eq(financialRecords.billingClientId, record.billingClientId)
    : record.counterpartyCif
      ? eq(financialRecords.counterpartyCif, record.counterpartyCif)
      : record.counterpartyName
        ? eq(financialRecords.counterpartyName, record.counterpartyName)
        : null
  if (!partner) return { count: 0, total: 0, currency: record.currency }

  const [row] = await db
    .select({
      count: sql<number>`COUNT(*)`.mapWith(Number),
      total: sql<number>`COALESCE(SUM(${financialRecords.amount}), 0)::float8`.mapWith(Number),
    })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        ne(financialRecords.type, 'proforma'),
        sql`NOT ${isDraftSql}`,
        eq(financialRecords.direction, record.direction),
        eq(financialRecords.currency, record.currency),
        partner,
      ),
    )
  return { count: row?.count ?? 0, total: row?.total ?? 0, currency: record.currency }
}

export async function getRecordDetail(id: string) {
  const [row] = await db
    .select({
      ...recordColumns,
      correctsRecordId: financialRecords.correctsRecordId,
      convertedToRecordId: financialRecords.convertedToRecordId,
      proformaStatus: financialRecords.proformaStatus,
      updatedAt: financialRecords.updatedAt,
      paidAmount: sql<number>`${paidAmountSql}::float8`.mapWith(Number),
      remaining: sql<number>`${remainingSql}::float8`.mapWith(Number),
      isDraft: sql<boolean>`${isDraftSql}`,
    })
    .from(financialRecords)
    .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
  if (!row) return null
  const { correctsRecordId, convertedToRecordId, proformaStatus, remaining } = row
  const record = toPublicRow(row)

  const [lineRows, paymentRows, history, correctedBy, linked, sameClient] = await Promise.all([
    db
      .select({
        id: invoiceLineItems.id,
        position: invoiceLineItems.position,
        description: invoiceLineItems.description,
        quantity: invoiceLineItems.quantity,
        unitPrice: invoiceLineItems.unitPrice,
        vatRate: invoiceLineItems.vatRate,
      })
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.invoiceId, id), isNull(invoiceLineItems.deletedAt)))
      .orderBy(asc(invoiceLineItems.position)),
    db
      .select({
        id: invoicePayments.id,
        amount: invoicePayments.amount,
        currency: invoicePayments.currency,
        paidAt: invoicePayments.paidAt,
        method: invoicePayments.method,
        reference: invoicePayments.reference,
        note: invoicePayments.note,
        fromBank: sql<boolean>`${invoicePayments.bankTransactionId} IS NOT NULL`,
        createdAt: invoicePayments.createdAt,
        deletedAt: invoicePayments.deletedAt,
        actorId: users.id,
        actorName: users.displayName,
      })
      .from(invoicePayments)
      .leftJoin(users, eq(users.id, invoicePayments.createdByUserId))
      .where(eq(invoicePayments.recordId, id))
      .orderBy(asc(invoicePayments.paidAt), asc(invoicePayments.createdAt)),
    listEntityHistory(HISTORY_ENTITY_TYPES, id),
    db
      .select({
        id: financialRecords.id,
        documentNumber: financialRecords.documentNumber,
        amount: sql<number>`${financialRecords.amount}::float8`.mapWith(Number),
        issuedAt: financialRecords.issuedAt,
      })
      .from(financialRecords)
      .where(and(eq(financialRecords.correctsRecordId, id), isNull(financialRecords.deletedAt), isNotNull(financialRecords.documentNumber)))
      .orderBy(asc(financialRecords.issuedAt)),
    // The records this one points at, in one query: the invoice it corrects and the invoice made from it.
    correctsRecordId || convertedToRecordId
      ? db
          .select({ id: financialRecords.id, documentNumber: financialRecords.documentNumber, issuedAt: financialRecords.issuedAt })
          .from(financialRecords)
          .where(and(inArray(financialRecords.id, [correctsRecordId, convertedToRecordId].filter((v): v is string => Boolean(v))), isNull(financialRecords.deletedAt)))
      : Promise.resolve([]),
    sameClientTotals({
      id,
      direction: row.direction,
      currency: row.currency,
      billingClientId: row.billingClientId,
      counterpartyCif: row.counterpartyCif,
      counterpartyName: row.counterpartyName,
    }),
  ])

  const lines = lineRows.map((line) => ({
    id: line.id,
    position: line.position,
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    vatRate: Number(line.vatRate),
  }))
  // Net and VAT are only known from lines; a received document imported without them keeps just the gross.
  const gross = Number(row.amount)
  const computed = lines.length > 0 ? computeTotals(lines) : null
  const totals = {
    net: computed ? computed.lineExtensionAmount : null,
    vat: computed ? computed.taxAmount : null,
    gross: computed ? computed.taxInclusiveAmount : gross,
  }

  const payments = paymentRows
    .filter((payment) => !payment.deletedAt)
    .map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      paidAt: payment.paidAt,
      method: payment.method,
      reference: payment.reference,
      note: payment.note,
      fromBank: payment.fromBank,
      createdAt: payment.createdAt,
      createdBy: payment.actorId ? { id: payment.actorId, name: payment.actorName } : null,
    }))

  const byId = new Map(linked.map((other) => [other.id, other]))
  const corrects = correctsRecordId ? byId.get(correctsRecordId) : undefined
  const convertedTo = convertedToRecordId ? byId.get(convertedToRecordId) : undefined

  const timeline: TimelineEntry[] = [
    ...history
      .filter((entry) => entry.action !== PAYMENT_ADDED)
      .map((entry) => ({ at: entry.at, kind: entry.action, actor: entry.actor, detail: entry.changes })),
    ...paymentRows.map((payment) => ({
      at: payment.createdAt,
      kind: PAYMENT_ADDED,
      actor: payment.actorId ? { id: payment.actorId, name: payment.actorName } : null,
      detail: { amount: Number(payment.amount), currency: payment.currency, paidAt: payment.paidAt, method: payment.method, reference: payment.reference },
    })),
  ]
  if (!timeline.some((entry) => entry.kind.endsWith('.creata'))) {
    timeline.push({ at: row.createdAt, kind: 'record.created', actor: null, detail: null })
  }
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime())

  return {
    record,
    lines,
    totals,
    payments,
    remaining,
    storno: { corrects: corrects ?? undefined, correctedBy },
    proforma: row.type === 'proforma' ? { status: proformaStatus, convertedTo: convertedTo ?? undefined } : undefined,
    timeline,
    sameClient,
  }
}
