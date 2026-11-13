import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { computeTotals } from '../../connectors/anaf/xml-builder.js'
import { db } from '../../shared/db/client.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import { financialRecords, invoiceLineItems } from '../../shared/db/schema/index.js'
import { tr } from '../../shared/lib/i18n.js'
import { InvoicingError } from './errors.js'
import { companyToday, invoiceColumns } from './service.js'
import type { StornoCreateSchema } from './schema.js'

// Quantities have 3 decimals; whole thousandths keep the sums exact.
const toMilli = (value: string | number) => Math.round(Number(value) * 1000)
const fromMilli = (milli: number) => milli / 1000

/**
 * A storno draft: type invoice, `corrects_record_id` set, quantities negated and unit prices kept
 * positive (CIUS-RO code 380). Which original line a storno line reverses is its `position`,
 * copied unchanged: the lines of an issued invoice never move, so no extra column is needed.
 */
export async function createStornoDraft(id: string, input: z.infer<typeof StornoCreateSchema>) {
  return db.transaction(async (tx) => {
    // Two storno requests on the same invoice queue here, so the second sees the first one's draft.
    const [original] = await tx
      .select()
      .from(financialRecords)
      .where(and(eq(financialRecords.id, id), eq(financialRecords.source, 'generated'), isNull(financialRecords.deletedAt)))
      .for('update')
    if (!original) return null
    if (original.direction !== 'out' || original.type !== 'invoice' || !original.documentNumber || original.correctsRecordId) {
      throw new InvoicingError(409, 'NOT_STORNABLE', tr('errors.invoicing.notStornable'))
    }

    const originalLines = await tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.invoiceId, id), isNull(invoiceLineItems.deletedAt)))
      .orderBy(asc(invoiceLineItems.position))

    // Reversed so far: numbered stornos and drafts alike, a draft reserves its quantity.
    const reversedRows = await tx
      .select({ position: invoiceLineItems.position, reversed: sql<string>`COALESCE(SUM(-${invoiceLineItems.quantity}), 0)::text` })
      .from(invoiceLineItems)
      .innerJoin(financialRecords, eq(financialRecords.id, invoiceLineItems.invoiceId))
      .where(and(eq(financialRecords.correctsRecordId, id), isNull(financialRecords.deletedAt), isNull(invoiceLineItems.deletedAt)))
      .groupBy(invoiceLineItems.position)
    const reversedByPosition = new Map(reversedRows.map((row) => [row.position, toMilli(row.reversed)]))

    const remainingOf = (line: (typeof originalLines)[number]) =>
      toMilli(line.quantity) - (reversedByPosition.get(line.position) ?? 0)

    let picked: Array<{ line: (typeof originalLines)[number]; milli: number }>
    if (input.mode === 'full') {
      picked = originalLines.map((line) => ({ line, milli: remainingOf(line) })).filter((entry) => entry.milli > 0)
      if (picked.length === 0) throw new InvoicingError(409, 'NOTHING_TO_STORNO', tr('errors.invoicing.nothingToStorno'))
    } else {
      const requested = input.lines ?? []
      if (requested.length === 0) throw new InvoicingError(400, 'STORNO_LINES_REQUIRED', tr('errors.invoicing.stornoLinesRequired'))
      if (new Set(requested.map((entry) => entry.lineId)).size !== requested.length) {
        throw new InvoicingError(400, 'STORNO_LINE_DUPLICATE', tr('errors.invoicing.stornoLineDuplicate'))
      }
      const byId = new Map(originalLines.map((line) => [line.id, line]))
      picked = requested.map((entry) => {
        const line = byId.get(entry.lineId)
        if (!line) throw new InvoicingError(400, 'STORNO_LINE_UNKNOWN', tr('errors.invoicing.stornoLineUnknown'))
        const milli = toMilli(entry.quantity)
        const remaining = remainingOf(line)
        if (milli <= 0 || milli > remaining) {
          throw new InvoicingError(
            400,
            'STORNO_EXCEEDS',
            tr('errors.invoicing.stornoExceeds', {
              line: line.description,
              remaining: fromMilli(Math.max(remaining, 0)),
              requested: fromMilli(milli),
            }),
          )
        }
        return { line, milli }
      })
    }

    const stornoLines = picked.map(({ line, milli }) => ({
      description: line.description,
      quantity: -fromMilli(milli),
      unitPrice: Number(line.unitPrice),
      vatRate: Number(line.vatRate),
      position: line.position,
    }))
    const issuedAt = await companyToday()

    const [record] = await tx
      .insert(financialRecords)
      .values({
        ...createdByUserId(),
        ...updatedByUserId(),
        type: 'invoice',
        direction: 'out',
        source: 'generated',
        amount: computeTotals(stornoLines).taxInclusiveAmount.toFixed(2),
        currency: original.currency,
        issuedAt,
        // A credit note has nothing to be paid by a date, so it never counts as overdue.
        dueAt: null,
        billingClientId: original.billingClientId,
        counterpartyName: original.counterpartyName,
        counterpartyCif: original.counterpartyCif,
        anafStatus: 'draft',
        correctsRecordId: original.id,
      })
      .returning(invoiceColumns)
    if (!record) throw new Error(tr('errors.invoicing.insertFailed'))

    await tx.insert(invoiceLineItems).values(
      stornoLines.map((line) => ({
        invoiceId: record.id,
        position: line.position,
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        vatRate: String(line.vatRate),
      })),
    )

    await recordAudit({
      executor: tx,
      action: 'factura.storno.creata',
      entityType: 'invoice',
      entityId: record.id,
      changes: {
        sursa: [original.id, original.documentNumber],
        mod: [null, input.mode],
        suma: [null, `${record.amount} ${record.currency}`],
      },
    })
    return record
  })
}
