import argon2 from 'argon2'
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../src/shared/db/client.js'
import {
  auditLog,
  bankAccounts,
  bankTransactions,
  billingClients,
  financialRecords,
  invoicePayments,
  invoiceSequences,
  paymentMatches,
  roles,
  users,
} from '../src/shared/db/schema/index.js'

// Shared fixtures of the invoice-payments tests (Sprint 7). Everything created here is tracked and
// removed by cleanup(), so a second run on the same database starts from the same state.

export const RUN = Math.random().toString(36).slice(2, 8)
let counter = 0
export const uniqueNumber = (prefix = 'QAT') => `${prefix}-${RUN}-${String(++counter).padStart(4, '0')}`

const clientIds: string[] = []
const recordIds: string[] = []
const accountIds: string[] = []
const txnIds: string[] = []
const userIds: string[] = []
const roleIds: string[] = []
const extraAuditEntityIds: string[] = []
const sequenceSnapshots = new Map<string, typeof invoiceSequences.$inferSelect | null>()

export async function makeClient(overrides: Partial<typeof billingClients.$inferInsert> = {}) {
  const [row] = await db
    .insert(billingClients)
    .values({
      name: `QA Facturi ${RUN} ${++counter}`,
      cif: 'RO4444444',
      address: 'Str. Test 1',
      city: 'Brasov',
      county: 'Brasov',
      country: 'RO',
      ...overrides,
    })
    .returning()
  clientIds.push(row!.id)
  return row!
}

export async function makeRecord(overrides: Partial<typeof financialRecords.$inferInsert> = {}) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      source: 'generated',
      amount: '100.00',
      currency: 'RON',
      issuedAt: new Date(),
      documentNumber: uniqueNumber(),
      paymentStatus: 'unpaid',
      anafStatus: 'draft',
      ...overrides,
    })
    .returning()
  recordIds.push(row!.id)
  return row!
}

/** An issued (numbered) invoice, inserted directly. */
export const makeIssued = (overrides: Partial<typeof financialRecords.$inferInsert> = {}) => makeRecord(overrides)

/** A draft: an issued-direction invoice with no number. */
export const makeDraftRow = (overrides: Partial<typeof financialRecords.$inferInsert> = {}) =>
  makeRecord({ documentNumber: null, ...overrides })

export async function makeBankTxn(amount: string, overrides: Partial<typeof bankTransactions.$inferInsert> = {}) {
  let accountId = overrides.bankAccountId
  if (!accountId) {
    const [account] = await db.insert(bankAccounts).values({ provider: 'revolut', name: `QA ${RUN} account`, currency: 'RON' }).returning()
    accountIds.push(account!.id)
    accountId = account!.id
  }
  const [row] = await db
    .insert(bankTransactions)
    .values({
      bankAccountId: accountId,
      externalId: `qa-${RUN}-${++counter}`,
      amount,
      currency: 'RON',
      reference: 'plata',
      valueDate: new Date(),
      direction: 'in',
      ...overrides,
    })
    .returning()
  txnIds.push(row!.id)
  return row!
}

/** Track ids created by the code under test (drafts, stornos, duplicates) so cleanup() removes them. */
export const trackRecord = (id: string) => recordIds.push(id)
export const trackAudit = (entityId: string) => extraAuditEntityIds.push(entityId)

/** Point the invoice series at a private prefix so the test numbers cannot collide with real ones. */
export async function useTestSequence(key: 'invoice' | 'proforma', prefix: string) {
  const [existing] = await db.select().from(invoiceSequences).where(eq(invoiceSequences.key, key))
  sequenceSnapshots.set(key, existing ?? null)
  if (existing) {
    await db
      .update(invoiceSequences)
      .set({ prefix, separator: '-', yearFormat: 'none', padding: 4, startFrom: 1, currentValue: 0, lastResetYear: null, resetOn: 'never' })
      .where(eq(invoiceSequences.id, existing.id))
  } else {
    await db.insert(invoiceSequences).values({ key, prefix, separator: '-', yearFormat: 'none', padding: 4, startFrom: 1, resetOn: 'never' })
  }
}

export async function currentSequenceValue(key: 'invoice' | 'proforma') {
  const [row] = await db.select().from(invoiceSequences).where(eq(invoiceSequences.key, key))
  return row?.currentValue ?? 0
}

export async function makeUser(app: FastifyInstance, features: string[], kind: 'custom' | 'admin' = 'custom') {
  let roleId: string
  if (kind === 'admin') {
    const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
    roleId = adminRole!.id
  } else {
    const [role] = await db.insert(roles).values({ name: `QA facturi ${RUN} ${++counter}`, kind: 'custom', features }).returning()
    roleIds.push(role!.id)
    roleId = role!.id
  }
  const [user] = await db
    .insert(users)
    .values({ email: `qa-facturi-${RUN}-${counter}@test.local`, passwordHash: await argon2.hash('parola-de-test-123'), displayName: `QA ${counter}`, roleId })
    .returning()
  userIds.push(user!.id)
  return { id: user!.id, cookie: app.jwt.sign({ sub: user!.id, sv: user!.sessionVersion }) }
}

export async function cleanup() {
  // Whatever the code under test created for our clients (storno drafts, duplicates) goes too.
  if (clientIds.length) {
    const made = await db.select({ id: financialRecords.id }).from(financialRecords).where(inArray(financialRecords.billingClientId, clientIds))
    for (const row of made) if (!recordIds.includes(row.id)) recordIds.push(row.id)
  }
  const matches = txnIds.length || recordIds.length
    ? await db
        .select({ id: paymentMatches.id })
        .from(paymentMatches)
        .where(or(txnIds.length ? inArray(paymentMatches.bankTransactionId, txnIds) : undefined, recordIds.length ? inArray(paymentMatches.financialRecordId, recordIds) : undefined))
    : []
  const auditIds = [...recordIds, ...extraAuditEntityIds, ...matches.map((m) => m.id)]
  if (auditIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, auditIds))
  if (matches.length) await db.delete(paymentMatches).where(inArray(paymentMatches.id, matches.map((m) => m.id)))
  if (recordIds.length) {
    await db.delete(invoicePayments).where(inArray(invoicePayments.recordId, recordIds))
    // The links between documents are plain foreign keys: clear them before the rows go.
    await db
      .update(financialRecords)
      .set({ correctsRecordId: null, convertedToRecordId: null })
      .where(and(inArray(financialRecords.id, recordIds), or(isNotNull(financialRecords.correctsRecordId), isNotNull(financialRecords.convertedToRecordId))))
    await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
  }
  if (txnIds.length) await db.delete(bankTransactions).where(inArray(bankTransactions.id, txnIds))
  if (accountIds.length) await db.delete(bankAccounts).where(inArray(bankAccounts.id, accountIds))
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
  if (userIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.actorUserId, userIds))
    await db.delete(users).where(inArray(users.id, userIds))
  }
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
  for (const [key, snapshot] of sequenceSnapshots) {
    if (snapshot) await db.update(invoiceSequences).set(snapshot).where(eq(invoiceSequences.id, snapshot.id))
    else await db.delete(invoiceSequences).where(eq(invoiceSequences.key, key))
  }
  for (const list of [clientIds, recordIds, accountIds, txnIds, userIds, roleIds, extraAuditEntityIds]) list.length = 0
  sequenceSnapshots.clear()
}
