import { and, asc, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import {
  emailAttachments,
  emailMessages,
  financialRecords,
  recurringExpenses,
  supplierEmailRules,
} from '../../shared/db/schema/index.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import { archiveInvoiceDocuments } from '../../shared/lib/financial-archive.js'
import { httpError } from '../../shared/lib/http-error.js'
import { tr } from '../../shared/lib/i18n.js'
import { extractInvoiceHintsFromPdf } from '../../shared/lib/pdf-text.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import {
  SupplierEmailNotFoundError,
  loadVisibleEmailAttachment,
} from '../../shared/lib/supplier-email-ingest.js'
import {
  isValidSenderPattern,
  type ImportFromEmailBodySchema,
  type SupplierRuleBackfillSchema,
  type SupplierRuleCreateSchema,
  type SupplierRuleUpdateSchema,
} from './schema.js'
import { DuplicateDocumentNumberError } from './service.js'

// Supplier email rules and automatic/manual ingestion of PDF invoices received by email
// (e.g. Stripe/Anthropic, Hetzner, Cloudflare). Auto-ingested records start with
// `needsReview = true` and stay out of D301/D390 until a team member confirms the extracted
// number, date, and amount.

export { SupplierEmailNotFoundError }

export class SupplierEmailBadRequestError extends Error {
  readonly statusCode = 400
  readonly userFacing = true
  constructor(message: string) {
    super(message)
    this.name = 'SupplierEmailBadRequestError'
  }
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } }
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

/** Extracts the lowercase email address from a raw `From` header such as `"Anthropic <invoice@mail.anthropic.com>"`. */
export function extractEmailAddress(fromHeader: string): string {
  const match = /<([^<>]+)>/.exec(fromHeader)
  return (match?.[1] ?? fromHeader).trim().toLowerCase()
}

function extractSenderDisplayName(fromHeader: string): string | null {
  const match = /^([^<]+)<[^<>]+>/.exec(fromHeader)
  if (!match?.[1]) return null
  const cleaned = match[1].replace(/^["']+|["']+$/g, '').trim()
  return cleaned || null
}

/**
 * Pure sender matcher for supplier email rules:
 * - Exact address pattern (`invoice+statements@mail.anthropic.com`): exact match on the bare lowercase email.
 * - Domain pattern (`@hetzner.com`): matches `user@hetzner.com` and subdomains like `billing@mail.hetzner.com`,
 *   while rejecting lookalike domains such as `user@evil-hetzner.com`.
 */
export function matchesSupplierSender(fromAddress: string, senderPattern: string): boolean {
  const bare = extractEmailAddress(fromAddress)
  const pattern = senderPattern.trim().toLowerCase()
  if (!bare || !pattern) return false

  if (pattern.startsWith('@')) {
    const patDomain = pattern.slice(1)
    if (!patDomain) return false
    const atIndex = bare.lastIndexOf('@')
    if (atIndex < 0) return false
    const domain = bare.slice(atIndex + 1)
    return domain === patDomain || domain.endsWith(`.${patDomain}`)
  }

  return bare === pattern
}

/**
 * Selects the best PDF attachment from a message's attachments list:
 * - Filters to PDFs only (`.pdf` extension or `application/pdf` content type).
 * - If `attachmentNamePattern` is set, keeps only PDFs whose filename contains it (case-insensitive).
 * - When multiple PDFs remain (e.g. Stripe attaches both `Invoice-*.pdf` and `Receipt-*.pdf`),
 *   prefers the first whose filename contains `invoice` / `factura` / `rechnung` and does not
 *   contain `receipt` / `chitanta`.
 */
export function selectMatchingPdfAttachment<
  T extends { id: string; filename: string; contentType?: string | null },
>(attachments: T[], attachmentNamePattern?: string | null): T | null {
  const pdfs = attachments.filter(
    (att) =>
      att.filename.toLowerCase().endsWith('.pdf') ||
      att.contentType?.toLowerCase() === 'application/pdf',
  )
  if (pdfs.length === 0) return null

  const pattern = attachmentNamePattern?.trim().toLowerCase()
  const candidates = pattern
    ? pdfs.filter((att) => att.filename.toLowerCase().includes(pattern))
    : pdfs
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!

  const preferred = candidates.find((att) => {
    const lower = att.filename.toLowerCase()
    const hasInvoiceWord =
      lower.includes('invoice') || lower.includes('factura') || lower.includes('rechnung')
    const hasReceiptWord = lower.includes('receipt') || lower.includes('chitanta')
    return hasInvoiceWord && !hasReceiptWord
  })
  return preferred ?? candidates[0]!
}

// ── Supplier email rules CRUD ────────────────────────────────────────────────

export async function listSupplierRules() {
  return db
    .select()
    .from(supplierEmailRules)
    .where(isNull(supplierEmailRules.deletedAt))
    .orderBy(asc(supplierEmailRules.counterpartyName), desc(supplierEmailRules.createdAt))
}

export async function createSupplierRule(
  input: z.infer<typeof SupplierRuleCreateSchema>,
  userId?: string,
) {
  const normalizedSender = input.senderPattern.trim().toLowerCase()
  const normalizedAttPattern = input.attachmentNamePattern?.trim() || null

  // If an identical active rule already exists for this sender + attachment pattern, update it in place.
  const [existing] = await db
    .select()
    .from(supplierEmailRules)
    .where(
      and(
        isNull(supplierEmailRules.deletedAt),
        sql`lower(${supplierEmailRules.senderPattern}) = ${normalizedSender}`,
        sql`coalesce(lower(${supplierEmailRules.attachmentNamePattern}), '') = ${normalizedAttPattern?.toLowerCase() ?? ''}`,
      ),
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(supplierEmailRules)
      .set({
        senderPattern: normalizedSender,
        subjectContains: input.subjectContains?.trim() || null,
        attachmentNamePattern: normalizedAttPattern,
        counterpartyName: input.counterpartyName.trim(),
        counterpartyCif: input.counterpartyCif?.trim() || null,
        counterpartyCountry: input.counterpartyCountry?.trim().toUpperCase() || null,
        currency: input.currency ?? 'EUR',
        category: input.category?.trim() || null,
        reverseChargeType: input.reverseChargeType ?? 'none',
        reverseChargeVatRate:
          input.reverseChargeVatRate != null ? String(input.reverseChargeVatRate) : null,
        recurringExpenseId: input.recurringExpenseId ?? null,
        active: input.active ?? true,
        updatedAt: new Date(),
        ...(userId ? { updatedByUserId: userId } : updatedByUserId()),
      })
      .where(eq(supplierEmailRules.id, existing.id))
      .returning()
    return updated!
  }

  const [row] = await db
    .insert(supplierEmailRules)
    .values({
      senderPattern: normalizedSender,
      subjectContains: input.subjectContains?.trim() || null,
      attachmentNamePattern: normalizedAttPattern,
      counterpartyName: input.counterpartyName.trim(),
      counterpartyCif: input.counterpartyCif?.trim() || null,
      counterpartyCountry: input.counterpartyCountry?.trim().toUpperCase() || null,
      currency: input.currency ?? 'EUR',
      category: input.category?.trim() || null,
      reverseChargeType: input.reverseChargeType ?? 'none',
      reverseChargeVatRate:
        input.reverseChargeVatRate != null ? String(input.reverseChargeVatRate) : null,
      recurringExpenseId: input.recurringExpenseId ?? null,
      active: input.active ?? true,
      ...(userId ? { createdByUserId: userId } : createdByUserId()),
    })
    .returning()
  return row!
}

export async function updateSupplierRule(
  id: string,
  input: z.infer<typeof SupplierRuleUpdateSchema>,
  userId?: string,
) {
  const [row] = await db
    .update(supplierEmailRules)
    .set({
      ...(input.senderPattern !== undefined
        ? { senderPattern: input.senderPattern.trim().toLowerCase() }
        : {}),
      ...(input.subjectContains !== undefined
        ? { subjectContains: input.subjectContains?.trim() || null }
        : {}),
      ...(input.attachmentNamePattern !== undefined
        ? { attachmentNamePattern: input.attachmentNamePattern?.trim() || null }
        : {}),
      ...(input.counterpartyName !== undefined
        ? { counterpartyName: input.counterpartyName.trim() }
        : {}),
      ...(input.counterpartyCif !== undefined
        ? { counterpartyCif: input.counterpartyCif?.trim() || null }
        : {}),
      ...(input.counterpartyCountry !== undefined
        ? { counterpartyCountry: input.counterpartyCountry?.trim().toUpperCase() || null }
        : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.category !== undefined ? { category: input.category?.trim() || null } : {}),
      ...(input.reverseChargeType !== undefined
        ? { reverseChargeType: input.reverseChargeType }
        : {}),
      ...(input.reverseChargeVatRate !== undefined
        ? {
            reverseChargeVatRate:
              input.reverseChargeVatRate != null ? String(input.reverseChargeVatRate) : null,
          }
        : {}),
      ...(input.recurringExpenseId !== undefined
        ? { recurringExpenseId: input.recurringExpenseId ?? null }
        : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      updatedAt: new Date(),
      ...(userId ? { updatedByUserId: userId } : updatedByUserId()),
    })
    .where(and(eq(supplierEmailRules.id, id), isNull(supplierEmailRules.deletedAt)))
    .returning()
  return row ?? null
}

export async function deleteSupplierRule(id: string) {
  const [row] = await db
    .update(supplierEmailRules)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      ...updatedByUserId(),
    })
    .where(and(eq(supplierEmailRules.id, id), isNull(supplierEmailRules.deletedAt)))
    .returning({ id: supplierEmailRules.id })
  return row ?? null
}

// ── Core ingestion pipeline ──────────────────────────────────────────────────

export interface IngestSupplierAttachmentParams {
  message: {
    id: string
    fromAddress: string
    subject: string
    receivedAt: Date
  }
  attachment: {
    id: string
    filename: string
    storagePath: string
    contentType?: string | null
  }
  rule?: typeof supplierEmailRules.$inferSelect | null
  overrides?: {
    counterpartyName: string
    counterpartyCif?: string | null
    counterpartyCountry?: string | null
    documentNumber?: string | null
    issuedAt?: Date
    amount?: number
    currency?: 'RON' | 'EUR' | 'USD'
    category?: string | null
    reverseChargeType?: 'none' | 'eu_services' | 'non_eu_services'
    reverseChargeVatRate?: number | null
  }
  isAutomatic: boolean
  userId?: string | null
}

export interface IngestSupplierAttachmentResult {
  status: 'skipped_existing' | 'linked_existing' | 'linked_recurring' | 'created'
  recordId: string
}

function monthBoundsOf(date: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  return { from, to }
}

export async function ingestSupplierEmailAttachment(
  params: IngestSupplierAttachmentParams,
): Promise<IngestSupplierAttachmentResult> {
  const { message, attachment, rule, overrides, isAutomatic, userId } = params

  // 1. Idempotency: check if this email attachment was already imported into financial_records.
  const [alreadyImported] = await db
    .select({ id: financialRecords.id })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.emailAttachmentId, attachment.id),
      ),
    )
    .limit(1)

  if (alreadyImported) {
    return { status: 'skipped_existing', recordId: alreadyImported.id }
  }

  // 2. Read the PDF from local storage, validate magic bytes, copy into supplier-invoices/, extract hints.
  const buffer = await readDocument(attachment.storagePath)
  if (!buffer || buffer.byteLength < 8 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new SupplierEmailBadRequestError(tr('errors.codes.INVALID_PDF_UPLOAD'))
  }

  const safeFilename = attachment.filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'invoice.pdf'
  const pdfStoragePath = await saveDocument(
    `supplier-invoices/${message.id}/${safeFilename}`,
    buffer,
  )
  const hints = await extractInvoiceHintsFromPdf(buffer)

  // 3. Resolve field values from overrides -> PDF hints -> supplier rule -> linked recurring expense.
  const counterpartyName = (
    overrides?.counterpartyName ??
    rule?.counterpartyName ??
    extractSenderDisplayName(message.fromAddress) ??
    extractEmailAddress(message.fromAddress)
  ).trim()
  const counterpartyCif =
    overrides?.counterpartyCif !== undefined
      ? overrides.counterpartyCif?.trim() || null
      : (rule?.counterpartyCif ?? null)
  const counterpartyCountry =
    overrides?.counterpartyCountry !== undefined
      ? overrides.counterpartyCountry?.trim().toUpperCase() || null
      : (rule?.counterpartyCountry ?? null)
  const reverseChargeType =
    overrides?.reverseChargeType ??
    (rule?.reverseChargeType as 'none' | 'eu_services' | 'non_eu_services' | undefined) ??
    'none'
  const reverseChargeVatRate =
    overrides?.reverseChargeVatRate !== undefined
      ? overrides.reverseChargeVatRate != null
        ? String(overrides.reverseChargeVatRate)
        : null
      : (rule?.reverseChargeVatRate ?? null)
  const category =
    overrides?.category !== undefined ? overrides.category?.trim() || null : (rule?.category ?? null)
  const currency =
    overrides?.currency ??
    hints.currency ??
    (rule?.currency as 'RON' | 'EUR' | 'USD' | undefined) ??
    'EUR'

  let issuedAt = message.receivedAt
  if (overrides?.issuedAt) {
    issuedAt = overrides.issuedAt
  } else if (hints.issuedAt) {
    const parsed = new Date(`${hints.issuedAt}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime())) {
      issuedAt = parsed
    }
  }

  const documentNumber =
    overrides?.documentNumber !== undefined
      ? overrides.documentNumber?.trim() || null
      : (hints.documentNumber?.trim() || null)

  let amount = 0
  if (overrides?.amount !== undefined) {
    amount = overrides.amount
  } else if (hints.amount != null && hints.amount > 0) {
    amount = hints.amount
  } else if (rule?.recurringExpenseId) {
    const [rec] = await db
      .select({ amount: recurringExpenses.amount })
      .from(recurringExpenses)
      .where(eq(recurringExpenses.id, rule.recurringExpenseId))
      .limit(1)
    if (rec) amount = Number(rec.amount)
  }

  const { from: monthFrom, to: monthTo } = monthBoundsOf(issuedAt)

  // 4a. If an e-Factura record already exists for the same supplier and documentNumber, only link the email.
  if (documentNumber) {
    const supplierMatch = counterpartyCif
      ? or(
          eq(financialRecords.counterpartyCif, counterpartyCif),
          sql`lower(${financialRecords.counterpartyName}) = ${counterpartyName.toLowerCase()}`,
        )
      : sql`lower(${financialRecords.counterpartyName}) = ${counterpartyName.toLowerCase()}`

    const [existingEfactura] = await db
      .select()
      .from(financialRecords)
      .where(
        and(
          isNull(financialRecords.deletedAt),
          eq(financialRecords.direction, 'in'),
          eq(financialRecords.source, 'anaf_efactura'),
          eq(financialRecords.documentNumber, documentNumber),
          supplierMatch,
        ),
      )
      .limit(1)

    if (existingEfactura) {
      await db
        .update(financialRecords)
        .set({
          emailMessageId: message.id,
          emailAttachmentId: attachment.id,
          supplierRuleId: rule?.id ?? existingEfactura.supplierRuleId,
          updatedAt: new Date(),
        })
        .where(eq(financialRecords.id, existingEfactura.id))
      return { status: 'linked_existing', recordId: existingEfactura.id }
    }
  }

  // 4b. If a recurring_expense row without a PDF was already materialized in the same month, enrich it.
  const recurringMatcher = rule?.recurringExpenseId
    ? or(
        sql`${financialRecords.meta}->>'recurringExpenseId' = ${rule.recurringExpenseId}`,
        sql`lower(${financialRecords.counterpartyName}) = ${counterpartyName.toLowerCase()}`,
      )
    : sql`lower(${financialRecords.counterpartyName}) = ${counterpartyName.toLowerCase()}`

  const [existingRecurring] = await db
    .select()
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'in'),
        eq(financialRecords.source, 'recurring_expense'),
        isNull(financialRecords.pdfStoragePath),
        gte(financialRecords.issuedAt, monthFrom),
        lt(financialRecords.issuedAt, monthTo),
        recurringMatcher,
      ),
    )
    .limit(1)

  if (existingRecurring?.documentNumber) {
    // A recurring row with a document number was already confirmed by hand and may already be in a
    // filed D301/D390: attach the PDF only, never overwrite its amount, date or review state.
    await db
      .update(financialRecords)
      .set({
        pdfStoragePath,
        emailMessageId: message.id,
        emailAttachmentId: attachment.id,
        supplierRuleId: rule?.id ?? existingRecurring.supplierRuleId,
        updatedAt: new Date(),
      })
      .where(eq(financialRecords.id, existingRecurring.id))
    await archiveInvoiceDocuments({
      recordId: existingRecurring.id,
      direction: 'in',
      issuedAt: existingRecurring.issuedAt,
      counterpartyName: existingRecurring.counterpartyName ?? counterpartyName,
      counterpartyCif: existingRecurring.counterpartyCif,
      documentNumber: existingRecurring.documentNumber,
      anafMessageId: existingRecurring.anafMessageId,
      pdfStoragePath,
      xmlStoragePath: existingRecurring.xmlStoragePath,
    })
    return { status: 'linked_recurring', recordId: existingRecurring.id }
  }

  if (existingRecurring) {
    const resolvedDocNum = documentNumber ?? existingRecurring.documentNumber
    const resolvedAmount =
      overrides?.amount !== undefined
        ? overrides.amount.toFixed(2)
        : hints.amount != null && hints.amount > 0
          ? hints.amount.toFixed(2)
          : existingRecurring.amount

    let updatedRecurring: typeof financialRecords.$inferSelect | undefined
    try {
      const [row] = await db
        .update(financialRecords)
        .set({
          pdfStoragePath,
          emailMessageId: message.id,
          emailAttachmentId: attachment.id,
          supplierRuleId: rule?.id ?? existingRecurring.supplierRuleId,
          documentNumber: resolvedDocNum,
          amount: resolvedAmount,
          currency,
          issuedAt,
          counterpartyName,
          counterpartyCif: counterpartyCif ?? existingRecurring.counterpartyCif,
          counterpartyCountry: counterpartyCountry ?? existingRecurring.counterpartyCountry,
          reverseChargeType:
            reverseChargeType !== 'none' ? reverseChargeType : existingRecurring.reverseChargeType,
          reverseChargeVatRate: reverseChargeVatRate ?? existingRecurring.reverseChargeVatRate,
          needsReview: isAutomatic,
          updatedAt: new Date(),
        })
        .where(eq(financialRecords.id, existingRecurring.id))
        .returning()
      updatedRecurring = row
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      const [row] = await db
        .update(financialRecords)
        .set({
          pdfStoragePath,
          emailMessageId: message.id,
          emailAttachmentId: attachment.id,
          supplierRuleId: rule?.id ?? existingRecurring.supplierRuleId,
          documentNumber: existingRecurring.documentNumber,
          description: resolvedDocNum ? `Factura ${resolvedDocNum}` : existingRecurring.description,
          amount: resolvedAmount,
          currency,
          issuedAt,
          needsReview: isAutomatic,
          updatedAt: new Date(),
        })
        .where(eq(financialRecords.id, existingRecurring.id))
        .returning()
      updatedRecurring = row
    }

    await archiveInvoiceDocuments({
      recordId: existingRecurring.id,
      direction: 'in',
      issuedAt,
      counterpartyName,
      counterpartyCif: counterpartyCif ?? existingRecurring.counterpartyCif,
      documentNumber: updatedRecurring?.documentNumber ?? existingRecurring.documentNumber,
      anafMessageId: existingRecurring.anafMessageId,
      pdfStoragePath,
      xmlStoragePath: existingRecurring.xmlStoragePath,
    })

    return { status: 'linked_recurring', recordId: existingRecurring.id }
  }

  // 4c. Otherwise, insert a new financial_record with source = 'email'.
  const baseValues: typeof financialRecords.$inferInsert = {
    type: 'invoice',
    direction: 'in',
    source: 'email',
    amount: amount.toFixed(2),
    currency,
    description: category ?? (message.subject ? message.subject.slice(0, 200) : counterpartyName),
    category,
    issuedAt,
    paidAt: null,
    paymentStatus: 'unpaid',
    documentNumber,
    counterpartyName,
    counterpartyCif,
    counterpartyCountry,
    reverseChargeType,
    reverseChargeVatRate,
    pdfStoragePath,
    needsReview: isAutomatic,
    emailMessageId: message.id,
    emailAttachmentId: attachment.id,
    supplierRuleId: rule?.id ?? null,
    // Lets jobs/recurring-expenses.ts see the month is covered when the email lands before the due date.
    ...(rule?.recurringExpenseId ? { meta: { recurringExpenseId: rule.recurringExpenseId } } : {}),
    ...(userId ? { createdByUserId: userId } : {}),
  }

  let inserted: typeof financialRecords.$inferSelect | undefined
  try {
    const [row] = await db.insert(financialRecords).values(baseValues).returning()
    inserted = row
  } catch (err) {
    if (!isUniqueViolation(err) || !documentNumber) throw err
    // Collision on uq_financial_records_doc_number: retry with documentNumber = null and keep the extracted number in description.
    const [row] = await db
      .insert(financialRecords)
      .values({
        ...baseValues,
        documentNumber: null,
        description: `Factura ${documentNumber}`,
      })
      .returning()
    inserted = row
  }

  if (!inserted) {
    throw new Error('Failed to insert supplier email financial record')
  }

  await archiveInvoiceDocuments({
    recordId: inserted.id,
    direction: 'in',
    issuedAt: inserted.issuedAt,
    counterpartyName: inserted.counterpartyName,
    counterpartyCif: inserted.counterpartyCif,
    documentNumber: inserted.documentNumber,
    anafMessageId: null,
    pdfStoragePath,
    xmlStoragePath: null,
  })

  return { status: 'created', recordId: inserted.id }
}

function findMatchingRuleForMessage<
  TRule extends typeof supplierEmailRules.$inferSelect,
  TAtt extends { id: string; filename: string; contentType?: string | null },
>(
  message: { fromAddress: string; subject: string },
  attachments: TAtt[],
  rules: TRule[],
): { rule: TRule; attachment: TAtt } | null {
  // Prioritize exact email rules over @domain rules, and rules with subject/attachment filters first.
  const sorted = [...rules].sort((a, b) => {
    const aExact = a.senderPattern.startsWith('@') ? 0 : 1
    const bExact = b.senderPattern.startsWith('@') ? 0 : 1
    if (aExact !== bExact) return bExact - aExact
    const aSpecificity = (a.attachmentNamePattern ? 1 : 0) + (a.subjectContains ? 1 : 0)
    const bSpecificity = (b.attachmentNamePattern ? 1 : 0) + (b.subjectContains ? 1 : 0)
    return bSpecificity - aSpecificity
  })

  for (const rule of sorted) {
    if (!matchesSupplierSender(message.fromAddress, rule.senderPattern)) continue
    if (
      rule.subjectContains &&
      !message.subject.toLowerCase().includes(rule.subjectContains.trim().toLowerCase())
    ) {
      continue
    }
    const attachment = selectMatchingPdfAttachment(attachments, rule.attachmentNamePattern)
    if (!attachment) continue
    return { rule, attachment }
  }
  return null
}

/**
 * Hook invoked after inbound email attachments are saved in `ingestCloudflareInboundEmail`.
 * Matches active supplier rules against the message and ingests the invoice PDF if matched.
 */
export async function tryIngestSupplierEmailMessage(
  messageId: string,
): Promise<{ matched: boolean; result?: IngestSupplierAttachmentResult }> {
  const [message] = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.id, messageId), isNull(emailMessages.deletedAt)))
    .limit(1)

  if (!message || message.direction !== 'in' || message.folder === 'spam' || message.folder === 'trash') {
    return { matched: false }
  }

  const attachments = await db
    .select()
    .from(emailAttachments)
    .where(and(eq(emailAttachments.messageId, messageId), isNull(emailAttachments.deletedAt)))

  if (attachments.length === 0) return { matched: false }

  const activeRules = await db
    .select()
    .from(supplierEmailRules)
    .where(and(eq(supplierEmailRules.active, true), isNull(supplierEmailRules.deletedAt)))

  if (activeRules.length === 0) return { matched: false }

  const match = findMatchingRuleForMessage(message, attachments, activeRules)
  if (!match) return { matched: false }

  const result = await ingestSupplierEmailAttachment({
    message: {
      id: message.id,
      fromAddress: message.fromAddress,
      subject: message.subject,
      receivedAt: message.receivedAt ?? message.createdAt,
    },
    attachment: match.attachment,
    rule: match.rule,
    isAutomatic: true,
  })

  return { matched: true, result }
}

/**
 * Retroactively scans recent inbound emails with PDF attachments and applies active supplier rules.
 */
export async function backfillSupplierEmailRules(
  input: z.infer<typeof SupplierRuleBackfillSchema>,
): Promise<{
  scannedMessages: number
  createdRecords: number
  linkedRecurring: number
  skippedExisting: number
}> {
  const ruleFilters = [isNull(supplierEmailRules.deletedAt), eq(supplierEmailRules.active, true)]
  if (input.ruleId) {
    ruleFilters.push(eq(supplierEmailRules.id, input.ruleId))
  }
  const rules = await db
    .select()
    .from(supplierEmailRules)
    .where(and(...ruleFilters))

  if (rules.length === 0) {
    return { scannedMessages: 0, createdRecords: 0, linkedRecurring: 0, skippedExisting: 0 }
  }

  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - input.months)

  const messages = await db
    .select({
      id: emailMessages.id,
      fromAddress: emailMessages.fromAddress,
      subject: emailMessages.subject,
      receivedAt: emailMessages.receivedAt,
      createdAt: emailMessages.createdAt,
    })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.direction, 'in'),
        isNull(emailMessages.deletedAt),
        gte(emailMessages.receivedAt, since),
        sql`${emailMessages.folder} NOT IN ('spam', 'trash')`,
        sql`EXISTS (
          SELECT 1 FROM email_attachments ea
          WHERE ea.message_id = ${emailMessages.id}
            AND ea.deleted_at IS NULL
            AND (lower(ea.filename) LIKE '%.pdf' OR lower(ea.content_type) = 'application/pdf')
        )`,
      ),
    )
    .orderBy(desc(emailMessages.receivedAt))
    .limit(200)

  let scannedMessages = 0
  let createdRecords = 0
  let linkedRecurring = 0
  let skippedExisting = 0

  for (const msg of messages) {
    scannedMessages += 1
    const attachments = await db
      .select()
      .from(emailAttachments)
      .where(and(eq(emailAttachments.messageId, msg.id), isNull(emailAttachments.deletedAt)))

    const match = findMatchingRuleForMessage(msg, attachments, rules)
    if (!match) continue

    try {
      const outcome = await ingestSupplierEmailAttachment({
        message: {
          id: msg.id,
          fromAddress: msg.fromAddress,
          subject: msg.subject,
          receivedAt: msg.receivedAt ?? msg.createdAt,
        },
        attachment: match.attachment,
        rule: match.rule,
        isAutomatic: true,
      })
      if (outcome.status === 'created') createdRecords += 1
      else if (outcome.status === 'linked_recurring') linkedRecurring += 1
      else skippedExisting += 1
    } catch (err) {
      console.error(`[supplier-email] backfill failed for message ${msg.id}: ${String(err)}`)
    }
  }

  return { scannedMessages, createdRecords, linkedRecurring, skippedExisting }
}

/**
 * Extracts invoice hints and rule defaults for a PDF email attachment before opening the
 * manual "Import as invoice" dialog in the Email module.
 */
export async function prefillFromEmailAttachment(
  me: SessionUser,
  messageId: string,
  attachmentId: string,
) {
  const { message, attachment } = await loadVisibleEmailAttachment(me, messageId, attachmentId)

  const buffer = await readDocument(attachment.storagePath)
  const hints = await extractInvoiceHintsFromPdf(buffer)

  const rules = await db
    .select()
    .from(supplierEmailRules)
    .where(isNull(supplierEmailRules.deletedAt))

  const matchedRule =
    rules.find((r) => matchesSupplierSender(message.fromAddress, r.senderPattern)) ?? null

  const [existingRecord] = await db
    .select({ id: financialRecords.id })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.emailAttachmentId, attachment.id),
      ),
    )
    .limit(1)

  const senderEmail = extractEmailAddress(message.fromAddress)
  const senderDisplayName = extractSenderDisplayName(message.fromAddress)

  return {
    messageId: message.id,
    attachmentId: attachment.id,
    filename: attachment.filename,
    fromAddress: message.fromAddress,
    senderEmail,
    subject: message.subject,
    receivedAt: message.receivedAt,
    hints,
    matchedRule,
    suggested: {
      counterpartyName: matchedRule?.counterpartyName ?? senderDisplayName ?? senderEmail,
      counterpartyCif: matchedRule?.counterpartyCif ?? null,
      counterpartyCountry: matchedRule?.counterpartyCountry ?? null,
      documentNumber: hints.documentNumber,
      issuedAt: hints.issuedAt ?? message.receivedAt.toISOString().slice(0, 10),
      amount: hints.amount,
      currency:
        hints.currency ??
        (matchedRule?.currency as 'RON' | 'EUR' | 'USD' | undefined) ??
        'EUR',
      category: matchedRule?.category ?? null,
      reverseChargeType:
        (matchedRule?.reverseChargeType as 'none' | 'eu_services' | 'non_eu_services' | undefined) ??
        'none',
      reverseChargeVatRate:
        matchedRule?.reverseChargeVatRate != null
          ? Number(matchedRule.reverseChargeVatRate)
          : null,
      senderPattern: matchedRule?.senderPattern ?? senderEmail,
      attachmentNamePattern: matchedRule?.attachmentNamePattern ?? null,
    },
    existingRecordId: existingRecord?.id ?? null,
  }
}

/**
 * Imports a PDF email attachment as a confirmed supplier invoice (`needsReview = false`),
 * optionally saving a recurring supplier email rule if the caller has `facturi.setari`.
 */
export async function importInvoiceFromEmail(
  me: SessionUser,
  input: z.infer<typeof ImportFromEmailBodySchema>,
  canManageRules: boolean,
) {
  const { message, attachment } = await loadVisibleEmailAttachment(
    me,
    input.messageId,
    input.attachmentId,
  )

  let savedRule: typeof supplierEmailRules.$inferSelect | null = null
  if (input.createRule && canManageRules) {
    const rawPattern = (input.senderPattern || extractEmailAddress(message.fromAddress))
      .trim()
      .toLowerCase()
    if (!isValidSenderPattern(rawPattern)) {
      throw httpError(400, 'SENDER_PATTERN_INVALID')
    }
    savedRule = await createSupplierRule(
      {
        senderPattern: rawPattern,
        subjectContains: null,
        attachmentNamePattern: input.attachmentNamePattern ?? null,
        counterpartyName: input.counterpartyName,
        counterpartyCif: input.counterpartyCif ?? null,
        counterpartyCountry: input.counterpartyCountry ?? null,
        currency: input.currency,
        category: input.category ?? null,
        reverseChargeType: input.reverseChargeType,
        reverseChargeVatRate: input.reverseChargeVatRate ?? null,
        recurringExpenseId: null,
        active: true,
      },
      me.id,
    )
  }

  // If this attachment was already auto-ingested (e.g. with needsReview = true), update and confirm it.
  const [existing] = await db
    .select()
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.emailAttachmentId, attachment.id),
      ),
    )
    .limit(1)

  if (existing) {
    let updated: typeof financialRecords.$inferSelect | undefined
    try {
      const [row] = await db
        .update(financialRecords)
        .set({
          counterpartyName: input.counterpartyName.trim(),
          counterpartyCif: input.counterpartyCif?.trim() || null,
          counterpartyCountry: input.counterpartyCountry?.trim().toUpperCase() || null,
          documentNumber: input.documentNumber?.trim() || null,
          issuedAt: input.issuedAt,
          amount: input.amount.toFixed(2),
          currency: input.currency,
          category: input.category?.trim() || null,
          reverseChargeType: input.reverseChargeType,
          reverseChargeVatRate:
            input.reverseChargeVatRate != null ? String(input.reverseChargeVatRate) : null,
          needsReview: false,
          supplierRuleId: savedRule?.id ?? existing.supplierRuleId,
          updatedAt: new Date(),
          ...updatedByUserId(),
        })
        .where(eq(financialRecords.id, existing.id))
        .returning()
      updated = row
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DuplicateDocumentNumberError(input.documentNumber ?? '')
      }
      throw err
    }

    if (updated?.pdfStoragePath) {
      await archiveInvoiceDocuments({
        recordId: updated.id,
        direction: 'in',
        issuedAt: updated.issuedAt,
        counterpartyName: updated.counterpartyName,
        counterpartyCif: updated.counterpartyCif,
        documentNumber: updated.documentNumber,
        anafMessageId: updated.anafMessageId,
        pdfStoragePath: updated.pdfStoragePath,
        xmlStoragePath: updated.xmlStoragePath,
      })
    }

    await recordAudit({
      action: 'factura.email.importata',
      entityType: 'financial_record',
      entityId: existing.id,
      actorUserId: me.id,
    })

    return {
      status: 'updated_existing' as const,
      recordId: existing.id,
      rule: savedRule,
    }
  }

  const outcome = await ingestSupplierEmailAttachment({
    message,
    attachment,
    rule: savedRule,
    overrides: {
      counterpartyName: input.counterpartyName,
      counterpartyCif: input.counterpartyCif ?? null,
      counterpartyCountry: input.counterpartyCountry ?? null,
      documentNumber: input.documentNumber ?? null,
      issuedAt: input.issuedAt,
      amount: input.amount,
      currency: input.currency,
      category: input.category ?? null,
      reverseChargeType: input.reverseChargeType,
      reverseChargeVatRate: input.reverseChargeVatRate ?? null,
    },
    isAutomatic: false,
    userId: me.id,
  })

  await recordAudit({
    action: 'factura.email.importata',
    entityType: 'financial_record',
    entityId: outcome.recordId,
    actorUserId: me.id,
  })

  return {
    status: outcome.status,
    recordId: outcome.recordId,
    rule: savedRule,
  }
}
