import fs from 'node:fs/promises'
import path from 'node:path'
import argon2 from 'argon2'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
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
  accountingMonthClosures,
  archiveFiles,
  archiveFolders,
  auditLog,
  financialRecords,
  recurringExpenses,
  roles,
  users,
} = await import('../../shared/db/schema/index.js')
const { saveDocument } = await import('../../shared/lib/storage.js')

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')

const app = await buildServer()
await app.ready()

const [role] = await db
  .insert(roles)
  .values({
    name: `QA month close ${Date.now()}`,
    kind: 'custom',
    features: ['facturi.view', 'facturi.emitere'],
  })
  .returning()

const [user] = await db
  .insert(users)
  .values({
    email: `qa-month-close-${Date.now()}@example.com`,
    passwordHash: await argon2.hash('test-password-123'),
    roleId: role!.id,
  })
  .returning()

const token = await sessionToken(app, user!.id, user!.sessionVersion)

const createdRecordIds: string[] = []
const createdRecurringIds: string[] = []
const createdStoragePaths: string[] = []
const closedMonths: string[] = []

afterAll(async () => {
  if (createdRecordIds.length) {
    const recs = await db
      .select({ archiveFileId: financialRecords.archiveFileId })
      .from(financialRecords)
      .where(inArray(financialRecords.id, createdRecordIds))
    await db.delete(financialRecords).where(inArray(financialRecords.id, createdRecordIds))
    const archiveIds = recs.map((r) => r.archiveFileId).filter((v): v is string => Boolean(v))
    if (archiveIds.length) {
      await db.delete(archiveFiles).where(inArray(archiveFiles.id, archiveIds))
    }
  }
  if (createdRecurringIds.length) {
    await db.delete(recurringExpenses).where(inArray(recurringExpenses.id, createdRecurringIds))
  }
  if (closedMonths.length) {
    const closures = await db
      .select({ id: accountingMonthClosures.id })
      .from(accountingMonthClosures)
      .where(inArray(accountingMonthClosures.period, closedMonths))
    const closureIds = closures.map((c) => c.id)
    if (closureIds.length) {
      await db.delete(auditLog).where(inArray(auditLog.entityId, closureIds))
      await db.delete(accountingMonthClosures).where(inArray(accountingMonthClosures.id, closureIds))
    }
  }
  await db.delete(archiveFolders).where(eq(archiveFolders.ownerUserId, user!.id))
  await db.delete(users).where(eq(users.id, user!.id))
  await db.delete(roles).where(eq(roles.id, role!.id))

  const storageDir = process.env.STORAGE_DIR ?? './storage-test'
  for (const rel of createdStoragePaths) {
    await fs.rm(path.resolve(storageDir, rel), { force: true }).catch(() => undefined)
  }
  await app.close()
})

const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, payload, cookies: { vana_session: token } })

describe('month-close integration (DB + server)', () => {
  it('1) GET /api/accounting/month-close returns month records and only recurring expenses created in/before that month', async () => {
    const targetMonth = '2026-06'
    const [inv] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'out',
        source: 'manual',
        amount: '250.00',
        currency: 'RON',
        issuedAt: new Date('2026-06-15T10:00:00.000Z'),
        paymentStatus: 'paid',
        paidAt: new Date('2026-06-15T10:00:00.000Z'),
        documentNumber: `MC-TEST-${Date.now()}`,
        counterpartyName: 'Month Close Client SRL',
      })
      .returning()
    createdRecordIds.push(inv!.id)

    const [recBefore] = await db
      .insert(recurringExpenses)
      .values({
        description: 'Early Subscription',
        counterpartyName: 'Early Vendor SRL',
        amount: '40.00',
        currency: 'EUR',
        cycle: 'monthly',
        cycleDay: 10,
        nextDueDate: '2026-06-10',
        active: true,
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
      })
      .returning()
    createdRecurringIds.push(recBefore!.id)

    const [recAfter] = await db
      .insert(recurringExpenses)
      .values({
        description: 'Future Subscription',
        counterpartyName: 'Future Vendor SRL',
        amount: '60.00',
        currency: 'EUR',
        cycle: 'monthly',
        cycleDay: 10,
        nextDueDate: '2026-08-10',
        active: true,
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      })
      .returning()
    createdRecurringIds.push(recAfter!.id)

    const res = await call('GET', `/api/accounting/month-close?month=${targetMonth}`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data as {
      month: string
      items: Array<{ kind: string; id?: string; recurringExpenseId?: string | null }>
    }

    expect(data.month).toBe(targetMonth)
    expect(data.items.some((i) => i.kind === 'record' && i.id === inv!.id)).toBe(true)
    expect(
      data.items.some((i) => i.kind === 'expected' && i.recurringExpenseId === recBefore!.id),
    ).toBe(true)
    expect(
      data.items.some((i) => i.kind === 'expected' && i.recurringExpenseId === recAfter!.id),
    ).toBe(false)
  })

  it('2) POST /api/accounting/month-close/archive-missing archives unarchived PDF and populates archive_file_id', async () => {
    const targetMonth = '2026-05'
    const docNum = `ARCH-${Date.now()}`
    const pdfStoragePath = await saveDocument(
      `supplier-invoices/test/${docNum}.pdf`,
      MINIMAL_PDF,
    )
    createdStoragePaths.push(pdfStoragePath)

    const [rec] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'in',
        source: 'manual',
        amount: '120.00',
        currency: 'RON',
        issuedAt: new Date('2026-05-12T10:00:00.000Z'),
        paymentStatus: 'paid',
        paidAt: new Date('2026-05-12T10:00:00.000Z'),
        documentNumber: docNum,
        counterpartyName: 'Archive Target SRL',
        pdfStoragePath,
        archiveFileId: null,
      })
      .returning()
    createdRecordIds.push(rec!.id)

    const res = await call('POST', '/api/accounting/month-close/archive-missing', {
      month: targetMonth,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.archivedCount).toBeGreaterThanOrEqual(1)

    const [updated] = await db
      .select({ archiveFileId: financialRecords.archiveFileId })
      .from(financialRecords)
      .where(eq(financialRecords.id, rec!.id))
    expect(updated?.archiveFileId).toBeTruthy()
  })

  it('3) PUT /api/accounting/month-close/status closes and reopens a month and logs audit entries', async () => {
    const targetMonth = '2025-11'
    closedMonths.push(targetMonth)

    const closeRes = await call('PUT', '/api/accounting/month-close/status', {
      month: targetMonth,
      closed: true,
      note: 'All documents verified',
    })
    expect(closeRes.statusCode).toBe(200)
    expect(closeRes.json().data.closed).toBe(true)

    const [closure] = await db
      .select({ id: accountingMonthClosures.id })
      .from(accountingMonthClosures)
      .where(eq(accountingMonthClosures.period, targetMonth))
    expect(closure).toBeDefined()

    const reopenRes = await call('PUT', '/api/accounting/month-close/status', {
      month: targetMonth,
      closed: false,
    })
    expect(reopenRes.statusCode).toBe(200)
    expect(reopenRes.json().data.closed).toBe(false)

    const logs = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'accounting_month_closure'), eq(auditLog.entityId, closure!.id)))
    const actions = logs.map((l) => l.action)
    expect(actions).toContain('contabilitate.luna.inchisa')
    expect(actions).toContain('contabilitate.luna.redeschisa')
  })
})
