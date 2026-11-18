import fs from 'node:fs/promises'
import path from 'node:path'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { extractInvoiceHintsFromText } from '../../shared/lib/pdf-text.js'
import { SupplierRuleCreateSchema } from './schema.js'
import { sessionToken } from '../../shared/testing/session-token.js'

vi.mock('../../shared/lib/r2.js', () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  deleteManyFromR2: vi.fn().mockResolvedValue(undefined),
  downloadFromR2: vi.fn().mockResolvedValue(Buffer.from('fake pdf bytes')),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned-fake'),
  uploadToR2: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../shared/lib/thumbnail.js', () => ({
  generatePdfThumbnail: vi.fn().mockResolvedValue(null),
}))

const { buildServer } = await import('../../app.js')
const { db } = await import('../../shared/db/client.js')
const {
  archiveFiles,
  archiveFolders,
  auditLog,
  emailAttachments,
  emailMessages,
  emailThreads,
  financialRecords,
  recurringExpenses,
  roles,
  supplierEmailRules,
  userMailboxes,
  users,
} = await import('../../shared/db/schema/index.js')
const { saveDocument } = await import('../../shared/lib/storage.js')
const d301 = await import('./d301.js')
const {
  extractEmailAddress,
  matchesSupplierSender,
  selectMatchingPdfAttachment,
  tryIngestSupplierEmailMessage,
} = await import('./supplier-email.js')

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')

describe('extractEmailAddress', () => {
  it('extracts bare lowercase address from display header or plain address', () => {
    expect(extractEmailAddress('"Anthropic, PBC" <Invoice+Statements@Mail.Anthropic.com>')).toBe(
      'invoice+statements@mail.anthropic.com',
    )
    expect(extractEmailAddress('  BILLING@Hetzner.COM  ')).toBe('billing@hetzner.com')
  })
})

describe('matchesSupplierSender', () => {
  it('matches exact email address case-insensitively', () => {
    expect(
      matchesSupplierSender(
        'Anthropic <invoice+statements@mail.anthropic.com>',
        'invoice+statements@mail.anthropic.com',
      ),
    ).toBe(true)
    expect(
      matchesSupplierSender(
        'Anthropic <other@mail.anthropic.com>',
        'invoice+statements@mail.anthropic.com',
      ),
    ).toBe(false)
  })

  it('matches domain and subdomains while rejecting lookalike domains', () => {
    expect(matchesSupplierSender('Hetzner <billing@hetzner.com>', '@hetzner.com')).toBe(true)
    expect(matchesSupplierSender('billing@mail.hetzner.com', '@hetzner.com')).toBe(true)
    expect(matchesSupplierSender('attacker@evil-hetzner.com', '@hetzner.com')).toBe(false)
    expect(matchesSupplierSender('hetzner.com@other.org', '@hetzner.com')).toBe(false)
  })
})

describe('selectMatchingPdfAttachment', () => {
  it('prefers Invoice-*.pdf over Receipt-*.pdf when multiple PDFs are attached', () => {
    const picked = selectMatchingPdfAttachment([
      { id: '1', filename: 'Receipt-1234.pdf', contentType: 'application/pdf' },
      { id: '2', filename: 'Invoice-ABCD-001.pdf', contentType: 'application/pdf' },
      { id: '3', filename: 'notes.txt', contentType: 'text/plain' },
    ])
    expect(picked?.id).toBe('2')
  })

  it('filters by attachmentNamePattern when provided', () => {
    const picked = selectMatchingPdfAttachment(
      [
        { id: '1', filename: 'Receipt-1234.pdf', contentType: 'application/pdf' },
        { id: '2', filename: 'Invoice-1234.pdf', contentType: 'application/pdf' },
      ],
      'Invoice-',
    )
    expect(picked?.id).toBe('2')

    expect(
      selectMatchingPdfAttachment(
        [{ id: '1', filename: 'Receipt-1234.pdf', contentType: 'application/pdf' }],
        'Invoice-',
      ),
    ).toBeNull()
  })
})

describe('extractInvoiceHintsFromText', () => {
  it('extracts invoice number, issued date, amount and currency', () => {
    const sample = `
      Anthropic, PBC
      Invoice number: INV-2026-8841
      Date of issue: 2026-10-14
      Total due: €45.00 EUR
    `
    const hints = extractInvoiceHintsFromText(sample)
    expect(hints.documentNumber).toBe('INV-2026-8841')
    expect(hints.issuedAt).toBe('2026-10-14')
    expect(hints.amount).toBe(45)
    expect(hints.currency).toBe('EUR')
  })
})

describe('SupplierRuleCreateSchema', () => {
  it('accepts valid email or @domain patterns and rejects malformed ones', () => {
    const valid = SupplierRuleCreateSchema.safeParse({
      senderPattern: '@hetzner.com',
      counterpartyName: 'Hetzner Online GmbH',
      counterpartyCountry: 'DE',
      currency: 'EUR',
      reverseChargeType: 'eu_services',
      reverseChargeVatRate: 21,
    })
    expect(valid.success).toBe(true)

    const invalid = SupplierRuleCreateSchema.safeParse({
      senderPattern: 'not-an-email',
      counterpartyName: 'Invalid',
    })
    expect(invalid.success).toBe(false)
  })
})

describe('supplier-email integration (DB + server)', () => {
  const createdThreadIds: string[] = []
  const createdMessageIds: string[] = []
  const createdAttachmentIds: string[] = []
  const createdRuleIds: string[] = []
  const createdRecurringIds: string[] = []
  const createdRecordIds: string[] = []
  const createdUserIds: string[] = []
  const createdRoleIds: string[] = []
  const createdStoragePaths: string[] = []

  let app: Awaited<ReturnType<typeof buildServer>>

  const setupApp = async () => {
    if (!app) {
      app = await buildServer()
      await app.ready()
    }
    return app
  }

  afterAll(async () => {
    if (createdRecordIds.length) {
      const recs = await db
        .select({ pdfStoragePath: financialRecords.pdfStoragePath, archiveFileId: financialRecords.archiveFileId })
        .from(financialRecords)
        .where(inArray(financialRecords.id, createdRecordIds))
      for (const r of recs) {
        if (r.pdfStoragePath) createdStoragePaths.push(r.pdfStoragePath)
      }
      await db.delete(auditLog).where(inArray(auditLog.entityId, createdRecordIds))
      await db.delete(financialRecords).where(inArray(financialRecords.id, createdRecordIds))
      const archiveIds = recs.map((r) => r.archiveFileId).filter((v): v is string => Boolean(v))
      if (archiveIds.length) {
        await db.delete(archiveFiles).where(inArray(archiveFiles.id, archiveIds))
      }
    }
    if (createdRuleIds.length) {
      await db.delete(supplierEmailRules).where(inArray(supplierEmailRules.id, createdRuleIds))
    }
    if (createdRecurringIds.length) {
      await db.delete(recurringExpenses).where(inArray(recurringExpenses.id, createdRecurringIds))
    }
    if (createdAttachmentIds.length) {
      await db.delete(emailAttachments).where(inArray(emailAttachments.id, createdAttachmentIds))
    }
    if (createdMessageIds.length) {
      await db.delete(emailMessages).where(inArray(emailMessages.id, createdMessageIds))
    }
    if (createdThreadIds.length) {
      await db.delete(emailThreads).where(inArray(emailThreads.id, createdThreadIds))
    }
    if (createdUserIds.length) {
      await db.delete(userMailboxes).where(inArray(userMailboxes.userId, createdUserIds))
      await db.delete(archiveFolders).where(inArray(archiveFolders.ownerUserId, createdUserIds))
      await db.delete(users).where(inArray(users.id, createdUserIds))
    }
    if (createdRoleIds.length) {
      await db.delete(roles).where(inArray(roles.id, createdRoleIds))
    }
    const storageDir = process.env.STORAGE_DIR ?? './storage-test'
    for (const rel of createdStoragePaths) {
      await fs.rm(path.resolve(storageDir, rel), { force: true }).catch(() => undefined)
    }
    if (app) {
      await app.close()
    }
  })

  async function seedEmailWithPdf(opts: {
    fromAddress: string
    toAddress: string
    subject: string
    filename: string
    receivedAt: Date
  }) {
    const [thread] = await db
      .insert(emailThreads)
      .values({
        subject: opts.subject,
        participants: [opts.fromAddress, opts.toAddress],
        lastMessageAt: opts.receivedAt,
      })
      .returning()
    createdThreadIds.push(thread!.id)

    const [msg] = await db
      .insert(emailMessages)
      .values({
        threadId: thread!.id,
        direction: 'in',
        fromAddress: opts.fromAddress,
        toAddress: opts.toAddress,
        subject: opts.subject,
        bodyText: 'Invoice attached',
        receivedAt: opts.receivedAt,
      })
      .returning()
    createdMessageIds.push(msg!.id)

    const storagePath = await saveDocument(
      `email-attachments/${msg!.id}/${opts.filename}`,
      MINIMAL_PDF,
    )
    createdStoragePaths.push(storagePath)

    const [att] = await db
      .insert(emailAttachments)
      .values({
        messageId: msg!.id,
        filename: opts.filename,
        contentType: 'application/pdf',
        storagePath,
      })
      .returning()
    createdAttachmentIds.push(att!.id)

    return { thread: thread!, message: msg!, attachment: att! }
  }

  it('a) is idempotent when the same attachment is processed twice', async () => {
    const uniqueSender = `billing-${crypto.randomUUID().slice(0, 8)}@example-supplier.com`
    const [rule] = await db
      .insert(supplierEmailRules)
      .values({
        senderPattern: uniqueSender,
        attachmentNamePattern: 'Invoice-',
        counterpartyName: 'Idempotent Supplier SRL',
        currency: 'RON',
        reverseChargeType: 'none',
        active: true,
      })
      .returning()
    createdRuleIds.push(rule!.id)

    const { message, attachment } = await seedEmailWithPdf({
      fromAddress: `Billing <${uniqueSender}>`,
      toAddress: 'contact@vanadium.systems',
      subject: 'Your invoice',
      filename: 'Invoice-001.pdf',
      receivedAt: new Date('2026-08-10T10:00:00.000Z'),
    })

    const first = await tryIngestSupplierEmailMessage(message.id)
    expect(first.matched).toBe(true)
    expect(first.result?.status).toBe('created')
    if (first.result?.status === 'created') createdRecordIds.push(first.result.recordId)

    const second = await tryIngestSupplierEmailMessage(message.id)
    expect(second.matched).toBe(true)
    expect(second.result?.status).toBe('skipped_existing')

    const rows = await db
      .select({ id: financialRecords.id })
      .from(financialRecords)
      .where(eq(financialRecords.emailAttachmentId, attachment.id))
    expect(rows).toHaveLength(1)
  })

  it('b) links and completes an existing recurring_expense without PDF instead of duplicating', async () => {
    const uniqueSender = `recurring-${crypto.randomUUID().slice(0, 8)}@hetzner-test.example`
    const [recExp] = await db
      .insert(recurringExpenses)
      .values({
        description: 'Cloud Hosting',
        counterpartyName: 'Hetzner Test GmbH',
        amount: '35.00',
        currency: 'EUR',
        cycle: 'monthly',
        cycleDay: 5,
        nextDueDate: '2026-08-05',
        active: true,
      })
      .returning()
    createdRecurringIds.push(recExp!.id)

    const [rule] = await db
      .insert(supplierEmailRules)
      .values({
        senderPattern: uniqueSender,
        attachmentNamePattern: 'Invoice-',
        counterpartyName: 'Hetzner Test GmbH',
        counterpartyCountry: 'DE',
        counterpartyCif: 'DE812871812',
        currency: 'EUR',
        reverseChargeType: 'eu_services',
        reverseChargeVatRate: '21',
        recurringExpenseId: recExp!.id,
        active: true,
      })
      .returning()
    createdRuleIds.push(rule!.id)

    const [existingRecord] = await db
      .insert(financialRecords)
      .values({
        type: 'expense',
        direction: 'in',
        source: 'recurring_expense',
        amount: '35.00',
        currency: 'EUR',
        description: 'Cloud Hosting',
        issuedAt: new Date('2026-08-05T00:00:00.000Z'),
        paymentStatus: 'unpaid',
        counterpartyName: 'Hetzner Test GmbH',
        meta: { recurringExpenseId: recExp!.id },
      })
      .returning()
    createdRecordIds.push(existingRecord!.id)

    const { message, attachment } = await seedEmailWithPdf({
      fromAddress: uniqueSender,
      toAddress: 'contact@vanadium.systems',
      subject: 'Hetzner Invoice',
      filename: 'Invoice-2026-08.pdf',
      receivedAt: new Date('2026-08-12T09:00:00.000Z'),
    })

    const res = await tryIngestSupplierEmailMessage(message.id)
    expect(res.matched).toBe(true)
    expect(res.result?.status).toBe('linked_recurring')
    if (res.result?.status === 'linked_recurring') {
      expect(res.result.recordId).toBe(existingRecord!.id)
    }

    const [updated] = await db
      .select()
      .from(financialRecords)
      .where(eq(financialRecords.id, existingRecord!.id))
    expect(updated?.pdfStoragePath).toBeTruthy()
    expect(updated?.emailAttachmentId).toBe(attachment.id)
    expect(updated?.archiveFileId).toBeTruthy()

    const byAtt = await db
      .select({ id: financialRecords.id })
      .from(financialRecords)
      .where(eq(financialRecords.emailAttachmentId, attachment.id))
    expect(byAtt).toHaveLength(1)
  })

  it('b2) only attaches the PDF to a recurring row already confirmed by hand, keeping its values', async () => {
    const uniqueSender = `confirmed-${crypto.randomUUID().slice(0, 8)}@acme-test.example`
    const [recExp] = await db
      .insert(recurringExpenses)
      .values({
        description: 'Subscription',
        counterpartyName: 'Acme Confirmed Inc',
        amount: '18.00',
        currency: 'EUR',
        cycle: 'monthly',
        cycleDay: 25,
        nextDueDate: '2026-09-25',
        active: true,
      })
      .returning()
    createdRecurringIds.push(recExp!.id)

    const [rule] = await db
      .insert(supplierEmailRules)
      .values({
        senderPattern: uniqueSender,
        counterpartyName: 'Acme Confirmed Inc',
        currency: 'EUR',
        reverseChargeType: 'non_eu_services',
        reverseChargeVatRate: '21',
        recurringExpenseId: recExp!.id,
        active: true,
      })
      .returning()
    createdRuleIds.push(rule!.id)

    const issuedAt = new Date('2026-09-25T00:00:00.000Z')
    const [confirmedRow] = await db
      .insert(financialRecords)
      .values({
        type: 'expense',
        direction: 'in',
        source: 'recurring_expense',
        amount: '18.00',
        currency: 'EUR',
        description: 'Subscription',
        issuedAt,
        paymentStatus: 'unpaid',
        documentNumber: 'ACME-0005',
        counterpartyName: 'Acme Confirmed Inc',
        reverseChargeType: 'non_eu_services',
        reverseChargeVatRate: '21',
        meta: { recurringExpenseId: recExp!.id },
      })
      .returning()
    createdRecordIds.push(confirmedRow!.id)

    const { message, attachment } = await seedEmailWithPdf({
      fromAddress: uniqueSender,
      toAddress: 'contact@vanadium.systems',
      subject: 'Your receipt',
      filename: 'Invoice-0005.pdf',
      receivedAt: new Date('2026-09-26T09:00:00.000Z'),
    })

    const res = await tryIngestSupplierEmailMessage(message.id)
    expect(res.result?.status).toBe('linked_recurring')

    const [after] = await db.select().from(financialRecords).where(eq(financialRecords.id, confirmedRow!.id))
    expect(after?.emailAttachmentId).toBe(attachment.id)
    expect(after?.pdfStoragePath).toBeTruthy()
    expect(after?.needsReview).toBe(false)
    expect(after?.documentNumber).toBe('ACME-0005')
    expect(after?.amount).toBe('18.00')
    expect(after?.issuedAt.toISOString()).toBe(issuedAt.toISOString())
  })

  it('b3) a new email record for a rule tied to a recurring expense counts as that month materialized', async () => {
    const uniqueSender = `early-${crypto.randomUUID().slice(0, 8)}@acme-test.example`
    const [recExp] = await db
      .insert(recurringExpenses)
      .values({
        description: 'Hosting',
        counterpartyName: 'Acme Early GmbH',
        amount: '24.38',
        currency: 'EUR',
        cycle: 'monthly',
        cycleDay: 1,
        nextDueDate: '2026-07-01',
        active: true,
      })
      .returning()
    createdRecurringIds.push(recExp!.id)

    const [rule] = await db
      .insert(supplierEmailRules)
      .values({
        senderPattern: uniqueSender,
        counterpartyName: 'Acme Early GmbH',
        currency: 'EUR',
        reverseChargeType: 'eu_services',
        reverseChargeVatRate: '21',
        recurringExpenseId: recExp!.id,
        active: true,
      })
      .returning()
    createdRuleIds.push(rule!.id)

    const { message } = await seedEmailWithPdf({
      fromAddress: uniqueSender,
      toAddress: 'contact@vanadium.systems',
      subject: 'Invoice',
      filename: 'Invoice-2026-07.pdf',
      receivedAt: new Date('2026-07-01T02:00:00.000Z'),
    })

    const res = await tryIngestSupplierEmailMessage(message.id)
    expect(res.result?.status).toBe('created')
    if (res.result) createdRecordIds.push(res.result.recordId)

    const { hasExpenseMaterializedForDate } = await import('./service.js')
    expect(await hasExpenseMaterializedForDate(recExp!.id, '2026-07-01')).toBe(true)
    expect(await hasExpenseMaterializedForDate(recExp!.id, '2026-08-01')).toBe(false)
  })

  it('c) needsReview=true shows confirmed=false + warning in D301, then confirmed=true after confirm-review', async () => {
    const server = await setupApp()
    const [role] = await db
      .insert(roles)
      .values({
        name: `QA confirm review ${Date.now()}`,
        kind: 'custom',
        features: ['facturi.view', 'facturi.emitere'],
      })
      .returning()
    createdRoleIds.push(role!.id)

    const [user] = await db
      .insert(users)
      .values({
        email: `qa-confirm-${Date.now()}@example.com`,
        passwordHash: await argon2.hash('test-password-123'),
        roleId: role!.id,
      })
      .returning()
    createdUserIds.push(user!.id)
    const token = await sessionToken(server, user!.id, user!.sessionVersion)

    const month = '2026-07'
    const [rec] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'in',
        source: 'email',
        needsReview: true,
        amount: '100.00',
        currency: 'RON',
        issuedAt: new Date('2026-07-15T10:00:00.000Z'),
        paymentStatus: 'unpaid',
        counterpartyName: 'Cloudflare Test Inc',
        counterpartyCountry: 'US',
        reverseChargeType: 'non_eu_services',
        reverseChargeVatRate: '21',
      })
      .returning()
    createdRecordIds.push(rec!.id)

    const beforePreview = await d301.generateD301Preview(month)
    const beforeLine = beforePreview.lines.find((l) => l.recordId === rec!.id)
    expect(beforeLine).toBeDefined()
    expect(beforeLine?.confirmed).toBe(false)
    expect(beforePreview.warnings.some((w) => w.includes('Cloudflare Test Inc'))).toBe(true)

    const confirmRes = await server.inject({
      method: 'POST',
      url: `/api/accounting/records/${rec!.id}/confirm-review`,
      cookies: { vana_session: token },
      payload: {
        documentNumber: `CF-${Date.now()}`,
        amount: 100,
        currency: 'RON',
      },
    })
    expect(confirmRes.statusCode).toBe(200)

    const afterPreview = await d301.generateD301Preview(month)
    const afterLine = afterPreview.lines.find((l) => l.recordId === rec!.id)
    expect(afterLine).toBeDefined()
    expect(afterLine?.confirmed).toBe(true)
  })

  it('d) POST /api/accounting/email-import returns 404 when caller mailbox does not include message recipient', async () => {
    const server = await setupApp()
    const [role] = await db
      .insert(roles)
      .values({
        name: `QA mailbox scope ${Date.now()}`,
        kind: 'custom',
        features: ['facturi.view', 'facturi.emitere'],
      })
      .returning()
    createdRoleIds.push(role!.id)

    const [user] = await db
      .insert(users)
      .values({
        email: `qa-mailbox-${Date.now()}@example.com`,
        passwordHash: await argon2.hash('test-password-123'),
        roleId: role!.id,
      })
      .returning()
    createdUserIds.push(user!.id)

    // User only holds the `contact` mailbox (`contact@vanadium.systems`), not `stefan` (`stefan@vanadium.systems`).
    await db.insert(userMailboxes).values({ userId: user!.id, identityKey: 'contact' })
    const token = await sessionToken(server, user!.id, user!.sessionVersion)

    const { message, attachment } = await seedEmailWithPdf({
      fromAddress: 'billing@supplier.example.com',
      toAddress: 'stefan@vanadium.systems',
      subject: 'Private mailbox invoice',
      filename: 'Invoice-Private.pdf',
      receivedAt: new Date('2026-08-18T12:00:00.000Z'),
    })

    const res = await server.inject({
      method: 'POST',
      url: '/api/accounting/email-import',
      cookies: { vana_session: token },
      payload: {
        messageId: message.id,
        attachmentId: attachment.id,
        counterpartyName: 'Private Supplier',
        issuedAt: '2026-08-18',
        amount: 50,
        currency: 'EUR',
        reverseChargeType: 'none',
        saveRule: false,
      },
    })
    expect(res.statusCode).toBe(404)
  })
})
