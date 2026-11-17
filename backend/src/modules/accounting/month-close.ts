import crypto from 'node:crypto'
import { zipSync } from 'fflate'
import { and, desc, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import {
  accountingMonthClosures,
  archiveFiles,
  financialRecords,
  recurringExpenses,
  supplierEmailRules,
  users,
} from '../../shared/db/schema/index.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { archiveInvoiceDocuments } from '../../shared/lib/financial-archive.js'
import { tr } from '../../shared/lib/i18n.js'
import { wallClock, zonedTimeToUtc } from '../../shared/lib/schedule-recurrence.js'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import * as d301 from './d301.js'
import type { FulfillExpectedBodySchema } from './schema.js'
import {
  DuplicateDocumentNumberError,
  InvalidPdfUploadError,
  recordColumns,
  toPublicRow,
} from './service.js'

const MAX_UPLOAD_PDF_BYTES = 15 * 1024 * 1024

export interface MonthCloseRecordItem {
  kind: 'record'
  id: string
  direction: 'in' | 'out'
  source: string
  counterpartyName: string | null
  counterpartyCif: string | null
  counterpartyCountry: string | null
  documentNumber: string | null
  issuedAt: string
  amount: number
  currency: string
  paymentStatus: 'unpaid' | 'partial' | 'paid'
  reverseChargeType: 'none' | 'eu_services' | 'non_eu_services'
  reverseChargeVatRate: number | null
  needsReview: boolean
  hasPdf: boolean
  hasXml: boolean
  archiveFileId: string | null
  isArchived: boolean
  emailMessageId: string | null
  supplierRuleId: string | null
  senderSearchHint: string | null
}

export interface MonthCloseExpectedItem {
  kind: 'expected'
  expectedId: string
  expectedSource: 'recurring_expense' | 'supplier_rule'
  recurringExpenseId: string | null
  supplierRuleId: string | null
  counterpartyName: string
  counterpartyCif: string | null
  counterpartyCountry: string | null
  expectedDate: string
  amount: number | null
  currency: string
  category: string | null
  reverseChargeType: 'none' | 'eu_services' | 'non_eu_services'
  reverseChargeVatRate: number | null
  senderSearchHint: string | null
}

export type MonthCloseItem = MonthCloseRecordItem | MonthCloseExpectedItem

export interface MonthCloseCounts {
  all: number
  issued: number
  receivedEfactura: number
  receivedEmailOrManual: number
  expectedMissing: number
  unarchived: number
}

export interface MonthCloseResponse {
  month: string
  closure: {
    closed: boolean
    closedAt: string | null
    closedBy: { id: string; name: string | null } | null
    note: string | null
  }
  counts: MonthCloseCounts
  items: MonthCloseItem[]
}

function monthBounds(
  month: string,
  timeZone: string,
): { year: number; monthNum: number; from: Date; to: Date } {
  const [year, monthNum] = month.split('-').map(Number)
  const nextYear = monthNum === 12 ? year! + 1 : year!
  const nextMonth = monthNum === 12 ? 1 : monthNum! + 1
  const from = zonedTimeToUtc(year!, monthNum!, 1, 0, 0, timeZone)
  const to = zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, timeZone)
  return { year: year!, monthNum: monthNum!, from, to }
}

function maxExpectedMonth(timeZone: string): string {
  const local = wallClock(new Date(), timeZone)
  const nextYear = local.m === 12 ? local.y + 1 : local.y
  const nextMonth = local.m === 12 ? 1 : local.m + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

function isPgUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } }
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

export async function getMonthClose(month: string): Promise<MonthCloseResponse> {
  const timeZone = await getCompanyTimeZone()
  const { monthNum, from, to } = monthBounds(month, timeZone)

  const [recordRows, recurringRows, ruleRows, [closureRow]] = await Promise.all([
    db
      .select({
        id: financialRecords.id,
        direction: financialRecords.direction,
        source: financialRecords.source,
        counterpartyName: financialRecords.counterpartyName,
        counterpartyCif: financialRecords.counterpartyCif,
        counterpartyCountry: financialRecords.counterpartyCountry,
        documentNumber: financialRecords.documentNumber,
        issuedAt: financialRecords.issuedAt,
        amount: financialRecords.amount,
        currency: financialRecords.currency,
        paymentStatus: financialRecords.paymentStatus,
        reverseChargeType: financialRecords.reverseChargeType,
        reverseChargeVatRate: financialRecords.reverseChargeVatRate,
        needsReview: financialRecords.needsReview,
        pdfStoragePath: financialRecords.pdfStoragePath,
        xmlStoragePath: financialRecords.xmlStoragePath,
        archiveFileId: financialRecords.archiveFileId,
        emailMessageId: financialRecords.emailMessageId,
        supplierRuleId: financialRecords.supplierRuleId,
        meta: financialRecords.meta,
        activeArchiveId: archiveFiles.id,
        ruleSenderPattern: supplierEmailRules.senderPattern,
      })
      .from(financialRecords)
      .leftJoin(
        archiveFiles,
        and(eq(archiveFiles.id, financialRecords.archiveFileId), isNull(archiveFiles.deletedAt)),
      )
      .leftJoin(
        supplierEmailRules,
        and(eq(supplierEmailRules.id, financialRecords.supplierRuleId), isNull(supplierEmailRules.deletedAt)),
      )
      .where(
        and(
          isNull(financialRecords.deletedAt),
          or(eq(financialRecords.type, 'invoice'), eq(financialRecords.source, 'recurring_expense')),
          gte(financialRecords.issuedAt, from),
          lt(financialRecords.issuedAt, to),
        ),
      )
      .orderBy(desc(financialRecords.issuedAt), desc(financialRecords.id)),
    db
      .select()
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.active, true), isNull(recurringExpenses.deletedAt))),
    db
      .select()
      .from(supplierEmailRules)
      .where(and(eq(supplierEmailRules.active, true), isNull(supplierEmailRules.deletedAt))),
    db
      .select({
        id: accountingMonthClosures.id,
        closedAt: accountingMonthClosures.closedAt,
        note: accountingMonthClosures.note,
        closedById: users.id,
        closedByName: users.displayName,
      })
      .from(accountingMonthClosures)
      .leftJoin(users, eq(users.id, accountingMonthClosures.closedByUserId))
      .where(and(eq(accountingMonthClosures.period, month), isNull(accountingMonthClosures.deletedAt)))
      .limit(1),
  ])

  const recordItems: MonthCloseRecordItem[] = recordRows.map((r) => {
    const isArchived = Boolean(r.archiveFileId && r.activeArchiveId)
    return {
      kind: 'record',
      id: r.id,
      direction: r.direction,
      source: r.source,
      counterpartyName: r.counterpartyName,
      counterpartyCif: r.counterpartyCif,
      counterpartyCountry: r.counterpartyCountry,
      documentNumber: r.documentNumber,
      issuedAt: r.issuedAt.toISOString(),
      amount: Number(r.amount),
      currency: r.currency,
      paymentStatus: r.paymentStatus,
      reverseChargeType: r.reverseChargeType,
      reverseChargeVatRate: r.reverseChargeVatRate != null ? Number(r.reverseChargeVatRate) : null,
      needsReview: r.needsReview,
      hasPdf: Boolean(r.pdfStoragePath),
      hasXml: Boolean(r.xmlStoragePath),
      archiveFileId: isArchived ? r.archiveFileId : null,
      isArchived,
      emailMessageId: r.emailMessageId,
      supplierRuleId: r.supplierRuleId,
      senderSearchHint: r.ruleSenderPattern ? r.ruleSenderPattern.replace(/^@/, '') : r.counterpartyName,
    }
  })

  const incomingRecords = recordRows.filter((r) => r.direction === 'in')
  const incomingRecurringIds = new Set(
    incomingRecords
      .map((r) => (r.meta as { recurringExpenseId?: string } | null)?.recurringExpenseId)
      .filter((v): v is string => Boolean(v)),
  )
  const incomingRuleIds = new Set(
    incomingRecords.map((r) => r.supplierRuleId).filter((v): v is string => Boolean(v)),
  )
  const incomingNames = new Set(
    incomingRecords.map((r) => normalizeName(r.counterpartyName)).filter(Boolean),
  )

  const expectedItems: MonthCloseExpectedItem[] = []

  if (month <= maxExpectedMonth(timeZone)) {
    for (const rec of recurringRows) {
      const createdLocal = wallClock(rec.createdAt, timeZone)
      const createdMonth = `${createdLocal.y}-${String(createdLocal.m).padStart(2, '0')}`
      if (month < createdMonth) continue

      const annualMonth = rec.cycleMonth ?? Number(rec.nextDueDate.slice(5, 7))
      const isDueInMonth = rec.cycle === 'monthly' || (rec.cycle === 'annual' && annualMonth === monthNum)
      if (!isDueInMonth) continue

      const displayName = rec.counterpartyName ?? rec.description
      const normName = normalizeName(displayName)
      if (incomingRecurringIds.has(rec.id) || (normName && incomingNames.has(normName))) {
        continue
      }

      const linkedRule = ruleRows.find((rule) => rule.recurringExpenseId === rec.id) ?? null
      const day = String(Math.min(rec.cycleDay || 1, 28)).padStart(2, '0')
      expectedItems.push({
        kind: 'expected',
        expectedId: `exp-rec-${rec.id}`,
        expectedSource: 'recurring_expense',
        recurringExpenseId: rec.id,
        supplierRuleId: linkedRule?.id ?? null,
        counterpartyName: displayName,
        counterpartyCif: rec.counterpartyCif,
        counterpartyCountry: rec.counterpartyCountry,
        expectedDate: `${month}-${day}`,
        amount: Number(rec.amount),
        currency: rec.currency,
        category: rec.category,
        reverseChargeType: rec.reverseChargeType,
        reverseChargeVatRate: rec.reverseChargeVatRate != null ? Number(rec.reverseChargeVatRate) : null,
        senderSearchHint: linkedRule ? linkedRule.senderPattern.replace(/^@/, '') : displayName,
      })
    }

    for (const rule of ruleRows) {
      if (rule.recurringExpenseId) continue
      const normName = normalizeName(rule.counterpartyName)
      if (incomingRuleIds.has(rule.id) || (normName && incomingNames.has(normName))) {
        continue
      }

      expectedItems.push({
        kind: 'expected',
        expectedId: `exp-rule-${rule.id}`,
        expectedSource: 'supplier_rule',
        recurringExpenseId: null,
        supplierRuleId: rule.id,
        counterpartyName: rule.counterpartyName,
        counterpartyCif: rule.counterpartyCif,
        counterpartyCountry: rule.counterpartyCountry,
        expectedDate: `${month}-01`,
        amount: null,
        currency: rule.currency,
        category: rule.category,
        reverseChargeType: rule.reverseChargeType,
        reverseChargeVatRate: rule.reverseChargeVatRate != null ? Number(rule.reverseChargeVatRate) : null,
        senderSearchHint: rule.senderPattern.replace(/^@/, ''),
      })
    }
  }

  const items: MonthCloseItem[] = [...recordItems, ...expectedItems]

  const counts: MonthCloseCounts = {
    all: items.length,
    issued: recordItems.filter((r) => r.direction === 'out').length,
    receivedEfactura: recordItems.filter((r) => r.direction === 'in' && r.source === 'anaf_efactura').length,
    receivedEmailOrManual: recordItems.filter((r) => r.direction === 'in' && r.source !== 'anaf_efactura').length,
    expectedMissing:
      expectedItems.length +
      recordItems.filter((r) => r.source === 'recurring_expense' && !r.hasPdf).length,
    unarchived: recordItems.filter((r) => (r.hasPdf || r.hasXml) && !r.isArchived).length,
  }

  return {
    month,
    closure: {
      closed: Boolean(closureRow),
      closedAt: closureRow?.closedAt?.toISOString() ?? null,
      closedBy: closureRow?.closedById
        ? { id: closureRow.closedById, name: closureRow.closedByName ?? null }
        : null,
      note: closureRow?.note ?? null,
    },
    counts,
    items,
  }
}

export async function archiveMissingForMonth(
  month?: string,
): Promise<{ archivedCount: number; failedCount: number }> {
  const conditions = [
    isNull(financialRecords.deletedAt),
    or(eq(financialRecords.type, 'invoice'), eq(financialRecords.source, 'recurring_expense')),
    or(isNotNull(financialRecords.pdfStoragePath), isNotNull(financialRecords.xmlStoragePath)),
    isNull(archiveFiles.id),
  ]

  if (month) {
    const timeZone = await getCompanyTimeZone()
    const { from, to } = monthBounds(month, timeZone)
    conditions.push(gte(financialRecords.issuedAt, from), lt(financialRecords.issuedAt, to))
  }

  const rows = await db
    .select({
      id: financialRecords.id,
      direction: financialRecords.direction,
      issuedAt: financialRecords.issuedAt,
      counterpartyName: financialRecords.counterpartyName,
      counterpartyCif: financialRecords.counterpartyCif,
      documentNumber: financialRecords.documentNumber,
      anafMessageId: financialRecords.anafMessageId,
      pdfStoragePath: financialRecords.pdfStoragePath,
      xmlStoragePath: financialRecords.xmlStoragePath,
    })
    .from(financialRecords)
    .leftJoin(
      archiveFiles,
      and(eq(archiveFiles.id, financialRecords.archiveFileId), isNull(archiveFiles.deletedAt)),
    )
    .where(and(...conditions))

  let archivedCount = 0
  let failedCount = 0

  for (const r of rows) {
    const { pdfArchiveFileId, xmlArchiveFileId } = await archiveInvoiceDocuments({
      recordId: r.id,
      direction: r.direction,
      issuedAt: r.issuedAt,
      counterpartyName: r.counterpartyName,
      counterpartyCif: r.counterpartyCif,
      documentNumber: r.documentNumber,
      anafMessageId: r.anafMessageId,
      pdfStoragePath: r.pdfStoragePath,
      xmlStoragePath: r.xmlStoragePath,
    })
    if (pdfArchiveFileId || xmlArchiveFileId) {
      archivedCount += 1
    } else {
      failedCount += 1
    }
  }

  return { archivedCount, failedCount }
}

export async function fulfillExpectedRow(
  input: z.infer<typeof FulfillExpectedBodySchema>,
  userId?: string,
) {
  const buffer = Buffer.from(input.contentBase64, 'base64')
  if (buffer.byteLength > MAX_UPLOAD_PDF_BYTES) {
    throw new InvalidPdfUploadError(tr('errors.codes.INVALID_PDF_UPLOAD'))
  }
  if (buffer.byteLength < 8 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new InvalidPdfUploadError(tr('errors.codes.INVALID_PDF_UPLOAD'))
  }

  const safeFilename = input.filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'invoice.pdf'
  const timeZone = await getCompanyTimeZone()
  const { from, to } = monthBounds(input.month, timeZone)

  let existingId: string | null = null
  if (input.recurringExpenseId) {
    const candidates = await db
      .select({
        id: financialRecords.id,
        counterpartyName: financialRecords.counterpartyName,
        meta: financialRecords.meta,
      })
      .from(financialRecords)
      .where(
        and(
          isNull(financialRecords.deletedAt),
          eq(financialRecords.direction, 'in'),
          eq(financialRecords.source, 'recurring_expense'),
          isNull(financialRecords.pdfStoragePath),
          gte(financialRecords.issuedAt, from),
          lt(financialRecords.issuedAt, to),
        ),
      )

    const normInputName = normalizeName(input.counterpartyName)
    const matched = candidates.find((c) => {
      const recId = (c.meta as { recurringExpenseId?: string } | null)?.recurringExpenseId
      if (recId === input.recurringExpenseId) return true
      return Boolean(normInputName && normalizeName(c.counterpartyName) === normInputName)
    })
    existingId = matched?.id ?? null
  }

  const recordId = existingId ?? crypto.randomUUID()
  const pdfStoragePath = await saveDocument(`supplier-invoices/manual/${recordId}/${safeFilename}`, buffer)

  try {
    if (existingId) {
      await db
        .update(financialRecords)
        .set({
          pdfStoragePath,
          documentNumber: input.documentNumber?.trim() || null,
          issuedAt: input.issuedAt,
          amount: input.amount.toFixed(2),
          currency: input.currency,
          ...(input.counterpartyName ? { counterpartyName: input.counterpartyName.trim() } : {}),
          ...(input.counterpartyCif !== undefined
            ? { counterpartyCif: input.counterpartyCif?.trim() || null }
            : {}),
          ...(input.counterpartyCountry !== undefined
            ? { counterpartyCountry: input.counterpartyCountry?.trim().toUpperCase() || null }
            : {}),
          ...(input.reverseChargeType !== undefined
            ? { reverseChargeType: input.reverseChargeType }
            : {}),
          ...(input.reverseChargeVatRate !== undefined
            ? {
                reverseChargeVatRate:
                  input.reverseChargeVatRate != null ? String(input.reverseChargeVatRate) : null,
              }
            : {}),
          ...(input.supplierRuleId !== undefined ? { supplierRuleId: input.supplierRuleId ?? null } : {}),
          needsReview: false,
          updatedAt: new Date(),
          ...(userId ? { updatedByUserId: userId } : updatedByUserId()),
        })
        .where(eq(financialRecords.id, existingId))
    } else {
      await db.insert(financialRecords).values({
        id: recordId,
        type: 'invoice',
        direction: 'in',
        source: input.recurringExpenseId ? 'recurring_expense' : 'manual',
        needsReview: false,
        paymentStatus: 'paid',
        paidAt: input.issuedAt,
        issuedAt: input.issuedAt,
        amount: input.amount.toFixed(2),
        currency: input.currency,
        counterpartyName: input.counterpartyName?.trim() || null,
        counterpartyCif: input.counterpartyCif?.trim() || null,
        counterpartyCountry: input.counterpartyCountry?.trim().toUpperCase() || null,
        documentNumber: input.documentNumber?.trim() || null,
        category: input.category?.trim() || null,
        reverseChargeType: input.reverseChargeType ?? 'none',
        reverseChargeVatRate:
          input.reverseChargeVatRate != null ? String(input.reverseChargeVatRate) : null,
        supplierRuleId: input.supplierRuleId ?? null,
        pdfStoragePath,
        meta: input.recurringExpenseId ? { recurringExpenseId: input.recurringExpenseId } : null,
        ...(userId ? { createdByUserId: userId } : createdByUserId()),
      })
    }
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new DuplicateDocumentNumberError(input.documentNumber ?? '')
    }
    throw err
  }

  const [saved] = await db
    .select()
    .from(financialRecords)
    .where(eq(financialRecords.id, recordId))
    .limit(1)

  if (saved) {
    await archiveInvoiceDocuments({
      recordId: saved.id,
      direction: saved.direction,
      issuedAt: saved.issuedAt,
      counterpartyName: saved.counterpartyName,
      counterpartyCif: saved.counterpartyCif,
      documentNumber: saved.documentNumber,
      anafMessageId: saved.anafMessageId,
      pdfStoragePath: saved.pdfStoragePath,
      xmlStoragePath: saved.xmlStoragePath,
    })
  }

  const [publicRow] = await db
    .select(recordColumns)
    .from(financialRecords)
    .where(eq(financialRecords.id, recordId))
    .limit(1)

  return publicRow ? toPublicRow(publicRow) : null
}

export async function setMonthClosureStatus(
  month: string,
  closed: boolean,
  note: string | null | undefined,
  userId: string,
): Promise<{ closed: boolean; closedAt: string | null }> {
  const now = new Date()

  if (closed) {
    const [row] = await db
      .insert(accountingMonthClosures)
      .values({
        period: month,
        closedAt: now,
        closedByUserId: userId,
        note: note ?? null,
        createdByUserId: userId,
      })
      .onConflictDoUpdate({
        target: [accountingMonthClosures.tenantId, accountingMonthClosures.period],
        targetWhere: sql`${accountingMonthClosures.deletedAt} IS NULL`,
        set: {
          closedAt: now,
          closedByUserId: userId,
          note: note ?? null,
          deletedAt: null,
          updatedAt: now,
          updatedByUserId: userId,
        },
      })
      .returning({ id: accountingMonthClosures.id, closedAt: accountingMonthClosures.closedAt })

    await recordAudit({
      action: 'contabilitate.luna.inchisa',
      entityType: 'accounting_month_closure',
      entityId: row!.id,
      actorUserId: userId,
      changes: { month: [null, month] },
    })

    return { closed: true, closedAt: row!.closedAt.toISOString() }
  }

  const [existing] = await db
    .update(accountingMonthClosures)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedByUserId: userId,
    })
    .where(and(eq(accountingMonthClosures.period, month), isNull(accountingMonthClosures.deletedAt)))
    .returning({ id: accountingMonthClosures.id })

  if (existing) {
    await recordAudit({
      action: 'contabilitate.luna.redeschisa',
      entityType: 'accounting_month_closure',
      entityId: existing.id,
      actorUserId: userId,
      changes: { month: [month, null] },
    })
  }

  return { closed: false, closedAt: null }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function sanitizeZipFilename(raw: string): string {
  return raw.replace(/[/\\"]/g, '_').trim() || 'document'
}

export async function buildMonthPackageZip(
  month: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const timeZone = await getCompanyTimeZone()
  const { from, to } = monthBounds(month, timeZone)
  const [monthData, records] = await Promise.all([
    getMonthClose(month),
    db
      .select({
        id: financialRecords.id,
        direction: financialRecords.direction,
        documentNumber: financialRecords.documentNumber,
        counterpartyName: financialRecords.counterpartyName,
        pdfStoragePath: financialRecords.pdfStoragePath,
        xmlStoragePath: financialRecords.xmlStoragePath,
      })
      .from(financialRecords)
      .where(
        and(
          isNull(financialRecords.deletedAt),
          or(eq(financialRecords.type, 'invoice'), eq(financialRecords.source, 'recurring_expense')),
          gte(financialRecords.issuedAt, from),
          lt(financialRecords.issuedAt, to),
        ),
      ),
  ])

  const zipEntries: Record<string, Uint8Array> = {}
  const folderIssued = tr('monthCloseCsv.folderIssued')
  const folderReceived = tr('monthCloseCsv.folderReceived')
  const folderDeclarations = tr('monthCloseCsv.folderDeclarations')

  for (const r of records) {
    const folder = r.direction === 'out' ? folderIssued : folderReceived
    const base = sanitizeZipFilename(r.documentNumber ?? r.id)
    if (r.pdfStoragePath) {
      try {
        const pdf = await readDocument(r.pdfStoragePath)
        zipEntries[`${folder}/${base}.pdf`] = new Uint8Array(pdf)
      } catch {
        // Skip missing file on disk so one broken path does not abort the archive.
      }
    }
    if (r.xmlStoragePath) {
      try {
        const xml = await readDocument(r.xmlStoragePath)
        zipEntries[`${folder}/${base}.xml`] = new Uint8Array(xml)
      } catch {
        // Skip missing file on disk.
      }
    }
  }

  // Declarations (D301 / D390 XML) if confirmed lines exist in the month.
  try {
    const d301Preview = await d301.generateD301Preview(month)
    if (d301Preview.lines.some((l) => l.confirmed)) {
      const xml = await d301.exportD301Xml(month)
      zipEntries[`${folderDeclarations}/D301_${month}.xml`] = new TextEncoder().encode(xml)
    }
  } catch {
    // Company profile may be incomplete in demo/test environments.
  }

  try {
    const d390Preview = await d301.generateD390Preview(month)
    if (d390Preview.lines.some((l) => l.confirmed && l.reverseChargeType === 'eu_services')) {
      const xml = await d301.exportD390Xml(month)
      zipEntries[`${folderDeclarations}/D390_${month}.xml`] = new TextEncoder().encode(xml)
    }
  } catch {
    // Company profile / VAT intra code may be missing in demo/test environments.
  }

  const header = [
    tr('monthCloseCsv.colDirection'),
    tr('monthCloseCsv.colSource'),
    tr('monthCloseCsv.colPartner'),
    tr('monthCloseCsv.colCif'),
    tr('monthCloseCsv.colNumber'),
    tr('monthCloseCsv.colDate'),
    tr('monthCloseCsv.colAmount'),
    tr('monthCloseCsv.colCurrency'),
    tr('monthCloseCsv.colPaymentStatus'),
    tr('monthCloseCsv.colReverseCharge'),
    tr('monthCloseCsv.colHasPdf'),
    tr('monthCloseCsv.colHasXml'),
    tr('monthCloseCsv.colArchived'),
  ]
  const yesLabel = tr('monthCloseCsv.yes')
  const noLabel = tr('monthCloseCsv.no')
  const dirIssuedLabel = tr('monthCloseCsv.dirIssued')
  const dirReceivedLabel = tr('monthCloseCsv.dirReceived')
  const csvLines = [header.join(',')]
  for (const item of monthData.items) {
    if (item.kind !== 'record') continue
    csvLines.push(
      [
        item.direction === 'out' ? dirIssuedLabel : dirReceivedLabel,
        item.source,
        item.counterpartyName ?? '',
        item.counterpartyCif ?? '',
        item.documentNumber ?? '',
        item.issuedAt.slice(0, 10),
        item.amount.toFixed(2),
        item.currency,
        item.paymentStatus,
        item.reverseChargeType,
        item.hasPdf ? yesLabel : noLabel,
        item.hasXml ? yesLabel : noLabel,
        item.isArchived ? yesLabel : noLabel,
      ]
        .map(csvEscape)
        .join(','),
    )
  }

  const missingExpected = monthData.items.filter(
    (item): item is MonthCloseExpectedItem => item.kind === 'expected',
  )
  if (missingExpected.length > 0) {
    csvLines.push('')
    csvLines.push(
      [
        tr('monthCloseCsv.expectedMissingHeader'),
        tr('monthCloseCsv.colSupplier'),
        tr('monthCloseCsv.colCif'),
        tr('monthCloseCsv.colExpectedDate'),
        tr('monthCloseCsv.colAmount'),
        tr('monthCloseCsv.colCurrency'),
      ].join(','),
    )
    for (const exp of missingExpected) {
      csvLines.push(
        [
          exp.expectedSource,
          exp.counterpartyName,
          exp.counterpartyCif ?? '',
          exp.expectedDate,
          exp.amount != null ? exp.amount.toFixed(2) : '',
          exp.currency,
        ]
          .map(csvEscape)
          .join(','),
      )
    }
  }

  const summaryPrefix = tr('monthCloseCsv.filePrefixSummary')
  const zipPrefix = tr('monthCloseCsv.filePrefixZip')
  zipEntries[`${summaryPrefix}-${month}.csv`] = new TextEncoder().encode(csvLines.join('\n'))

  return {
    filename: `${zipPrefix}-${month}.zip`,
    buffer: Buffer.from(zipSync(zipEntries)),
  }
}
