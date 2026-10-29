import { and, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type { SpvMessage } from '../../connectors/types.js'
import { getCompany } from '../../shared/lib/company.js'
import { db } from '../../shared/db/client.js'
import {
  anafCredentials,
  billingClients,
  financialRecords,
  invoiceLineItems,
  recurringExpenses,
  spvMessages,
} from '../../shared/db/schema/index.js'
import { rollBillingDueDateOnPayment } from '../../shared/lib/billing-rollover.js'
import { computeNextOccurrence, dayAfter, type BillingCycle } from '../../shared/lib/billing-cycle.js'
import { renderPaymentConfirmationHtml } from '../../shared/lib/documents.js'
import { htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import type {
  ManualRecordCreateSchema,
  PaymentUpdateSchema,
  RecordsQuerySchema,
  RecurringExpenseCreateSchema,
  RecurringExpenseUpdateSchema,
  SpvMessageSaveBodySchema,
} from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

// Selecție explicită — fără meta cu XML-uri mari și fără nimic sensibil.
const recordColumns = {
  id: financialRecords.id,
  type: financialRecords.type,
  direction: financialRecords.direction,
  amount: financialRecords.amount,
  currency: financialRecords.currency,
  description: financialRecords.description,
  category: financialRecords.category,
  issuedAt: financialRecords.issuedAt,
  dueAt: financialRecords.dueAt,
  paidAt: financialRecords.paidAt,
  paymentStatus: financialRecords.paymentStatus,
  source: financialRecords.source,
  documentNumber: financialRecords.documentNumber,
  billingClientId: financialRecords.billingClientId,
  counterpartyName: financialRecords.counterpartyName,
  counterpartyCif: financialRecords.counterpartyCif,
  reverseChargeType: financialRecords.reverseChargeType,
  counterpartyCountry: financialRecords.counterpartyCountry,
  reverseChargeVatRate: financialRecords.reverseChargeVatRate,
  anafUploadId: financialRecords.anafUploadId,
  anafStatus: financialRecords.anafStatus,
  anafMessageId: financialRecords.anafMessageId,
  hasXml: financialRecords.xmlStoragePath,
  hasPdf: financialRecords.pdfStoragePath,
  createdAt: financialRecords.createdAt,
}

export async function listRecords(query: z.infer<typeof RecordsQuerySchema>) {
  const conditions: SQL[] = []
  if (query.direction) conditions.push(eq(financialRecords.direction, query.direction))
  if (query.type) conditions.push(eq(financialRecords.type, query.type))
  if (query.paymentStatus) conditions.push(eq(financialRecords.paymentStatus, query.paymentStatus))
  if (query.anafStatus) conditions.push(eq(financialRecords.anafStatus, query.anafStatus))
  if (query.from) conditions.push(gte(financialRecords.issuedAt, query.from))
  if (query.to) conditions.push(lte(financialRecords.issuedAt, query.to))

  const rows = await db
    .select(recordColumns)
    .from(financialRecords)
    .where(and(isNull(financialRecords.deletedAt), ...conditions))
    .orderBy(desc(financialRecords.issuedAt))
    .limit(query.limit)

  // hasXml/hasPdf sunt căi interne de storage — expunem doar boolean-ul. hasAnafPdf
  // e derivat din anafMessageId, DOAR pt. facturi emise (direction='out') — la primite,
  // pdfStoragePath e deja PDF-ul ANAF, nu există o a doua copie distinctă de descărcat
  // (vezi getAnafPdfPath mai jos).
  return rows.map(({ anafMessageId, ...row }) => ({
    ...row,
    hasXml: Boolean(row.hasXml),
    hasPdf: Boolean(row.hasPdf),
    hasAnafPdf: row.direction === 'out' && Boolean(anafMessageId),
  }))
}

export async function getRecord(id: string) {
  const [row] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
  if (!row) return null
  const lines = await db
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
    .orderBy(invoiceLineItems.position)

  const { xmlStoragePath, pdfStoragePath, anafMessageId, ...publicRow } = row
  return {
    ...publicRow,
    hasXml: Boolean(xmlStoragePath),
    hasPdf: Boolean(pdfStoragePath),
    hasAnafPdf: row.direction === 'out' && Boolean(anafMessageId),
    lines,
  }
}

/** Căile de storage — doar pentru rutele de download, nu pentru response-uri JSON. */
export async function getRecordStoragePaths(id: string) {
  const [row] = await db
    .select({
      xmlStoragePath: financialRecords.xmlStoragePath,
      pdfStoragePath: financialRecords.pdfStoragePath,
      documentNumber: financialRecords.documentNumber,
    })
    .from(financialRecords)
    .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
  return row ?? null
}

/** Calea PDF-ului randat de ANAF (a treia copie, distinctă de PDF-ul nostru) — nu e
 *  stocată explicit pe rând, se calculează din anafMessageId + anul emiterii, aceeași
 *  formulă folosită la salvare/arhivare în jobs/sync-anaf.ts (persistInvoiceDocuments). */
export async function getAnafPdfPath(id: string) {
  const [row] = await db
    .select({
      direction: financialRecords.direction,
      anafMessageId: financialRecords.anafMessageId,
      issuedAt: financialRecords.issuedAt,
      documentNumber: financialRecords.documentNumber,
    })
    .from(financialRecords)
    .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
  // Doar la emise — la primite, pdfStoragePath e deja PDF-ul ANAF (nicio a doua copie).
  if (!row?.anafMessageId || row.direction !== 'out') return null
  return {
    path: `outgoing/${row.issuedAt.getUTCFullYear()}/anaf_${row.anafMessageId}.pdf`,
    documentNumber: row.documentNumber,
  }
}

/** Regenerează pe loc PDF-ul „Confirmare de încasare" (același randat automat la
 *  marcarea plății, shared/lib/payment-confirmation.ts) — nu e persistat nicăieri
 *  (doar atașat la emailul de atunci), deci descărcarea manuală îl reconstruiește
 *  din datele curente ale facturii. Aruncă Error cu mesaj pt. utilizator — ruta
 *  traduce în 400/404, la fel ca restul serviciului (issueInvoice etc.). */
export async function generateConfirmationPdf(id: string) {
  const [record] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
  if (!record || record.direction !== 'out' || record.type !== 'invoice') {
    throw new Error(tr('errors.accounting.invoiceNotFound'))
  }
  if (record.paymentStatus !== 'paid' || !record.paidAt) {
    throw new Error(tr('errors.accounting.invoiceNotPaid'))
  }
  if (!isPdfAvailable()) {
    throw new Error(tr('errors.pdf.unavailable'))
  }

  let clientName = record.counterpartyName ?? 'Client'
  if (record.billingClientId) {
    const [client] = await db
      .select({ name: billingClients.name })
      .from(billingClients)
      .where(eq(billingClients.id, record.billingClientId))
    if (client) clientName = client.name
  }

  const { profile } = await getCompany()
  const documentNumber = record.documentNumber ?? record.id
  const html = renderPaymentConfirmationHtml({
    documentNumber,
    amount: Number(record.amount),
    currency: record.currency,
    paidAt: record.paidAt,
    clientName,
    company: { name: profile.name, email: profile.email },
  })
  const buffer = await htmlToPdf(html)
  return { buffer, documentNumber }
}

export async function createManualRecord(input: z.infer<typeof ManualRecordCreateSchema>) {
  const { reverseChargeVatRate, ...rest } = input
  const [row] = await db
    .insert(financialRecords)
    .values({
      ...rest,
      amount: String(input.amount),
      reverseChargeVatRate: reverseChargeVatRate !== undefined ? String(reverseChargeVatRate) : undefined,
      source: 'manual',
    })
    .returning(recordColumns)
  return row
}

export async function updatePayment(id: string, input: z.infer<typeof PaymentUpdateSchema>) {
  const [row] = await db
    .update(financialRecords)
    .set({
      paymentStatus: input.paymentStatus,
      paidAt: input.paymentStatus === 'paid' ? (input.paidAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
    .returning(recordColumns)

  // Vezi shared/lib/billing-rollover.ts — aceeași logică o folosește și bank-sync.ts (auto-match).
  if (row?.paymentStatus === 'paid' && row.billingClientId) {
    await rollBillingDueDateOnPayment(row.billingClientId, row.issuedAt)
  }

  return row ?? null
}

/** Starea conexiunii ANAF — NICIODATĂ token-urile. */
export async function getAnafStatus() {
  const [row] = await db
    .select({
      cif: anafCredentials.cif,
      status: anafCredentials.status,
      certAlias: anafCredentials.certAlias,
      expiresAt: anafCredentials.expiresAt,
      lastRefreshedAt: anafCredentials.lastRefreshedAt,
    })
    .from(anafCredentials)
    .where(isNull(anafCredentials.deletedAt))
    .limit(1)
  return row ?? { cif: null, status: 'unconfigured', certAlias: null, expiresAt: null, lastRefreshedAt: null }
}

// ── Cheltuieli recurente ──────────────────────────────────────────────────────
// Materializate automat în financial_records prin jobs/recurring-expenses.ts. Cheltuielile
// one-time folosesc createManualRecord de mai sus, direct, fără rând aici.

export async function listRecurringExpenses() {
  return db.select().from(recurringExpenses).where(isNull(recurringExpenses.deletedAt)).orderBy(desc(recurringExpenses.createdAt))
}

export async function createRecurringExpense(input: z.infer<typeof RecurringExpenseCreateSchema>) {
  const { startDate, reverseChargeVatRate, ...rest } = input
  const fromDate = startDate ?? new Date()
  const nextDueDate = computeNextOccurrence({ cycle: rest.cycle as BillingCycle, day: rest.cycleDay, month: rest.cycleMonth }, fromDate)

  const [row] = await db
    .insert(recurringExpenses)
    .values({
      ...rest,
      amount: String(rest.amount),
      reverseChargeVatRate: reverseChargeVatRate !== undefined ? String(reverseChargeVatRate) : undefined,
      nextDueDate,
    })
    .returning()
  return row
}

export async function updateRecurringExpense(id: string, input: z.infer<typeof RecurringExpenseUpdateSchema>) {
  const { amount, reverseChargeVatRate, ...rest } = input

  // Bug real (Stefan, 2026-08-01): schimbarea cycleDay/cycleMonth/cycle nu recalcula
  // nextDueDate — un abonament mutat de pe ziua 1 pe ziua 30 rămânea "blocat" pe scadența
  // veche. createRecurringExpense calculează nextDueDate la creare; update trebuie s-o
  // recalculeze la fel ori de câte ori cadența se schimbă.
  let nextDueDate: string | undefined
  if (input.cycle !== undefined || input.cycleDay !== undefined || input.cycleMonth !== undefined) {
    const [existing] = await db
      .select()
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt)))
    if (existing) {
      const cycle = (input.cycle ?? existing.cycle) as BillingCycle
      const cycleDay = input.cycleDay ?? existing.cycleDay
      const cycleMonth = input.cycleMonth !== undefined ? input.cycleMonth : (existing.cycleMonth ?? undefined)
      nextDueDate = computeNextOccurrence({ cycle, day: cycleDay, month: cycleMonth }, new Date())
    }
  }

  const [row] = await db
    .update(recurringExpenses)
    .set({
      ...rest,
      ...(amount !== undefined ? { amount: String(amount) } : {}),
      ...(reverseChargeVatRate !== undefined ? { reverseChargeVatRate: String(reverseChargeVatRate) } : {}),
      ...(nextDueDate !== undefined ? { nextDueDate } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt)))
    .returning()
  return row ?? null
}

export async function deleteRecurringExpense(id: string) {
  const [row] = await db
    .update(recurringExpenses)
    .set({ deletedAt: new Date() })
    .where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt)))
    .returning({ id: recurringExpenses.id })
  return row ?? null
}

/** Cheltuielile active, scadente azi sau mai devreme — folosit de jobs/recurring-expenses.ts. */
export async function listDueRecurringExpenses(todayIso: string) {
  return db
    .select()
    .from(recurringExpenses)
    .where(and(isNull(recurringExpenses.deletedAt), eq(recurringExpenses.active, true), lte(recurringExpenses.nextDueDate, todayIso)))
}

/** Idempotență — nu materializăm de două ori aceeași scadență dacă jobul rulează de mai multe ori. */
export async function hasExpenseMaterializedForDate(recurringExpenseId: string, dueDateIso: string): Promise<boolean> {
  const [row] = await db
    .select({ id: financialRecords.id })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(sql<string>`${financialRecords.meta}->>'recurringExpenseId'`, recurringExpenseId),
        eq(sql<string>`(${financialRecords.issuedAt} AT TIME ZONE 'UTC')::date::text`, dueDateIso),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** Scrie financial_record-ul zilei pt. o cheltuială recurentă scadentă. */
export async function materializeRecurringExpense(expense: typeof recurringExpenses.$inferSelect, dueDateIso: string) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'expense',
      direction: 'in',
      amount: expense.amount,
      currency: expense.currency,
      description: expense.description,
      category: expense.category,
      counterpartyName: expense.counterpartyName,
      counterpartyCif: expense.counterpartyCif,
      counterpartyCountry: expense.counterpartyCountry,
      reverseChargeType: expense.reverseChargeType,
      reverseChargeVatRate: expense.reverseChargeVatRate,
      issuedAt: new Date(`${dueDateIso}T00:00:00Z`),
      paymentStatus: 'unpaid',
      source: 'recurring_expense',
      meta: { recurringExpenseId: expense.id },
    })
    .returning(recordColumns)
  return row
}

/**
 * Rostogolește nextDueDate la următoarea apariție după scadența tocmai materializată
 * (`dayAfter`, ca ancoră — garantează o dată strict după perioada încheiată, chiar dacă jobul
 * rulează exact în ziua scadenței — la fel ca jobs/billing-cycle-rollover.ts).
 */
export async function rollRecurringExpenseNextDueDate(id: string, materializedDateIso: string) {
  const expense = (await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)))[0]
  if (!expense) return
  const nextDueDate = computeNextOccurrence(
    { cycle: expense.cycle as BillingCycle, day: expense.cycleDay, month: expense.cycleMonth },
    dayAfter(materializedDateIso),
  )
  await db.update(recurringExpenses).set({ nextDueDate, updatedAt: new Date() }).where(eq(recurringExpenses.id, id))
}

/**
 * Mesaje SPV salvate explicit (opt-in, buton „Salvează" — vezi spv-messages.ts). ANAF
 * își șterge mesajele din SPV după un timp; ce salvăm aici rămâne, indiferent de fereastra
 * de zile cerută de la ANAF la fetch-ul live.
 */
export async function saveSpvMessage(
  anafMessageId: string,
  input: z.infer<typeof SpvMessageSaveBodySchema>,
): Promise<SpvMessage> {
  const [row] = await db
    .insert(spvMessages)
    .values({
      anafMessageId,
      type: input.type,
      detail: input.detail,
      cif: input.cif,
      anafCreatedAt: input.createdAt,
    })
    .onConflictDoUpdate({
      target: spvMessages.anafMessageId,
      set: { type: input.type, detail: input.detail, updatedAt: new Date() },
    })
    .returning()
  return { id: row!.anafMessageId, type: row!.type, detail: row!.detail, cif: row!.cif, createdAt: row!.anafCreatedAt }
}

export async function listSavedSpvMessages(): Promise<SpvMessage[]> {
  const rows = await db
    .select()
    .from(spvMessages)
    .where(isNull(spvMessages.deletedAt))
    .orderBy(desc(spvMessages.anafCreatedAt))
  return rows.map((r) => ({ id: r.anafMessageId, type: r.type, detail: r.detail, cif: r.cif, createdAt: r.anafCreatedAt }))
}
