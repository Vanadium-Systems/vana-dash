import { and, asc, count, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import { financialRecords, invoiceLineItems } from '../../shared/db/schema/index.js'
import { generateProformaDocuments } from '../../shared/lib/documents.js'
import { tr } from '../../shared/lib/i18n.js'
import { nextInvoiceNumber } from '../../shared/lib/sequences.js'
import { InvoicingError } from './errors.js'
import type { ProformaListQuerySchema } from './schema.js'
import {
  assertLineSigns,
  companyToday,
  createDraftInvoice,
  eurRateFor,
  getGeneratedInvoice,
  invoiceColumns,
  loadInvoiceInput,
} from './service.js'

// A proforma is a priced offer, not a fiscal document: its own number series, an HTML/PDF with a
// "not a tax invoice" notice, no XML and no ANAF. The invoice made from it is an ordinary invoice.

const proformaFilter = and(eq(financialRecords.type, 'proforma'), isNull(financialRecords.deletedAt))

export async function listProformas(query: z.infer<typeof ProformaListQuerySchema>) {
  const conditions: SQL[] = []
  if (query.status === 'draft') conditions.push(isNull(financialRecords.documentNumber))
  else if (query.status) conditions.push(isNotNull(financialRecords.documentNumber), eq(financialRecords.proformaStatus, query.status))

  const where = and(proformaFilter, ...conditions)
  const [[totalRow], items] = await Promise.all([
    db.select({ total: count() }).from(financialRecords).where(where),
    db
      .select(invoiceColumns)
      .from(financialRecords)
      .where(where)
      .orderBy(desc(financialRecords.createdAt), desc(financialRecords.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ])
  return { items, total: totalRow?.total ?? 0 }
}

export async function issueProforma(id: string) {
  const record = await getGeneratedInvoice(id, 'proforma')
  if (!record) return null
  if (record.proformaStatus === 'cancelled') {
    throw new InvoicingError(409, 'PROFORMA_CANCELLED', tr('errors.invoicing.proformaCancelled'))
  }

  // Validate before a number is spent, as issueInvoice does. No county check: nothing goes to ANAF.
  assertLineSigns(record, (await loadInvoiceInput(record, { strict: false })).lines)

  const documentNumber = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ documentNumber: financialRecords.documentNumber })
      .from(financialRecords)
      .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
      .for('update')
    if (!locked) throw new InvoicingError(404, 'PROFORMA_NOT_FOUND', tr('errors.invoicing.proformaNotFound'))
    if (locked.documentNumber) throw new InvoicingError(409, 'ALREADY_ISSUED', tr('errors.invoicing.alreadyIssued'))
    const number = await nextInvoiceNumber('proforma', tx)
    await tx
      .update(financialRecords)
      .set({ documentNumber: number, updatedAt: new Date(), ...updatedByUserId() })
      .where(eq(financialRecords.id, id))
    await recordAudit({ executor: tx, action: 'proforma.emisa', entityType: 'invoice', entityId: id, changes: { documentNumber: [null, number] } })
    return number
  })

  // Documents are written outside the transaction (slow IO); the number is already allocated.
  const input = await loadInvoiceInput({ ...record, documentNumber }, { strict: false })
  const { pdfPath } = await generateProformaDocuments(id, input, await eurRateFor(input))
  const [row] = await db
    .update(financialRecords)
    .set({ pdfStoragePath: pdfPath, updatedAt: new Date() })
    .where(eq(financialRecords.id, id))
    .returning(invoiceColumns)
  return row
}

/** A draft invoice with the proforma's client and lines. The proforma turns `invoiced` when that invoice is issued, not now. */
export async function convertProforma(id: string) {
  const proforma = await getGeneratedInvoice(id, 'proforma')
  if (!proforma) return null
  assertConvertible(proforma)
  if (!proforma.billingClientId) throw new InvoicingError(409, 'PROFORMA_NO_CLIENT', tr('errors.invoicing.proformaNoClient'))

  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.invoiceId, id), isNull(invoiceLineItems.deletedAt)))
    .orderBy(asc(invoiceLineItems.position))

  return createDraftInvoice(
    {
      billingClientId: proforma.billingClientId,
      currency: proforma.currency,
      issuedAt: await companyToday(),
      note: proforma.description ?? undefined,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        vatRate: Number(line.vatRate),
      })),
    },
    {
      origin: { action: 'factura.din.proforma', id, label: proforma.documentNumber ?? id },
      inTransaction: async (tx, draft) => {
        // Two conversions at once: the second waits on the lock, then sees the link the first one set.
        const [locked] = await tx
          .select()
          .from(financialRecords)
          .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
          .for('update')
        if (!locked) throw new InvoicingError(404, 'PROFORMA_NOT_FOUND', tr('errors.invoicing.proformaNotFound'))
        assertConvertible(locked)
        await tx
          .update(financialRecords)
          .set({ convertedToRecordId: draft.id, updatedAt: new Date() })
          .where(eq(financialRecords.id, id))
        await recordAudit({
          executor: tx,
          action: 'proforma.convertita',
          entityType: 'invoice',
          entityId: id,
          changes: { factura: [null, draft.id] },
        })
      },
    },
  )
}

function assertConvertible(proforma: typeof financialRecords.$inferSelect) {
  if (!proforma.documentNumber) throw new InvoicingError(409, 'PROFORMA_NOT_ISSUED', tr('errors.invoicing.proformaNotIssued'))
  if (proforma.proformaStatus === 'cancelled') throw new InvoicingError(409, 'PROFORMA_CANCELLED', tr('errors.invoicing.proformaCancelled'))
  if (proforma.proformaStatus === 'invoiced') throw new InvoicingError(409, 'PROFORMA_INVOICED', tr('errors.invoicing.proformaInvoiced'))
  if (proforma.convertedToRecordId) {
    throw new InvoicingError(409, 'PROFORMA_ALREADY_CONVERTED', tr('errors.invoicing.proformaAlreadyConverted'))
  }
}

export async function cancelProforma(id: string) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ proformaStatus: financialRecords.proformaStatus })
      .from(financialRecords)
      .where(and(eq(financialRecords.id, id), proformaFilter, eq(financialRecords.source, 'generated')))
      .for('update')
    if (!locked) return null
    if (locked.proformaStatus === 'invoiced') throw new InvoicingError(409, 'PROFORMA_INVOICED', tr('errors.invoicing.proformaInvoiced'))
    if (locked.proformaStatus === 'cancelled') throw new InvoicingError(409, 'PROFORMA_CANCELLED', tr('errors.invoicing.proformaCancelled'))
    const [row] = await tx
      .update(financialRecords)
      .set({ proformaStatus: 'cancelled', updatedAt: new Date(), ...updatedByUserId() })
      .where(eq(financialRecords.id, id))
      .returning(invoiceColumns)
    await recordAudit({
      executor: tx,
      action: 'proforma.anulata',
      entityType: 'invoice',
      entityId: id,
      changes: { stare: [locked.proformaStatus, 'cancelled'] },
    })
    return row ?? null
  })
}
