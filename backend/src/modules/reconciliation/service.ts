import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { generateSelfSignedCertificate } from '../../connectors/revolut/certificate.js'
import { exchangeCode } from '../../connectors/revolut/oauth.js'
import { db } from '../../shared/db/client.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import {
  bankAccounts,
  bankTransactions,
  financialRecords,
  paymentMatches,
  vanagreenExtensionLog,
} from '../../shared/db/schema/index.js'
import { decryptApiKey, encryptApiKey } from '../../shared/lib/crypto.js'
import { sendPaymentConfirmationEmail } from '../../shared/lib/payment-confirmation.js'
import { notifyPush } from '../../shared/lib/push.js'
import { addPayment, isDraftSql, PaymentError, recalculatePaymentStatus, remainingSql, removePayment } from '../../shared/lib/payments.js'
import { saveRevolutTokens } from '../../shared/lib/revolut.js'
import type { BankAccountCreateSchema, BankAccountUpdateSchema, TransactionsQuerySchema } from './schema.js'
import {
  isAutoExtendEnabled,
  listVanagreenTenantsForMapping,
  maybeExtendSubscription,
  setAutoExtendEnabled,
  verifyVanagreenTenant,
} from './vanagreen-extension.js'
import { trFor, tr } from '../../shared/lib/i18n.js'

// Selecție explicită — apiKeyEnc/privateKeyEnc/accessTokenEnc/refreshTokenEnc nu
// părăsesc niciodată service-ul. certificatePem e PUBLIC (cheia publică a
// certificatului auto-semnat, de încărcat manual în Revolut Business Settings) — sigur de expus.
const accountColumns = {
  id: bankAccounts.id,
  provider: bankAccounts.provider,
  name: bankAccounts.name,
  accountRef: bankAccounts.accountRef,
  currency: bankAccounts.currency,
  lastSyncAt: bankAccounts.lastSyncAt,
  healthStatus: bankAccounts.healthStatus,
  createdAt: bankAccounts.createdAt,
  authStatus: bankAccounts.authStatus,
  tokenExpiresAt: bankAccounts.tokenExpiresAt,
  lastRefreshedAt: bankAccounts.lastRefreshedAt,
  clientId: bankAccounts.clientId,
  certificatePem: bankAccounts.certificatePem,
}

export async function listAccounts() {
  return db
    .select(accountColumns)
    .from(bankAccounts)
    .where(isNull(bankAccounts.deletedAt))
    .orderBy(bankAccounts.createdAt)
}

export async function getAccount(id: string) {
  const [row] = await db
    .select(accountColumns)
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), isNull(bankAccounts.deletedAt)))
  return row ?? null
}

export async function createAccount(input: z.infer<typeof BankAccountCreateSchema>) {
  const { apiKey, ...rest } = input
  const [row] = await db
    .insert(bankAccounts)
    .values({ ...rest, ...(apiKey ? { apiKeyEnc: encryptApiKey(apiKey) } : {}) })
    .returning(accountColumns)
  return row
}

export async function updateAccount(id: string, input: z.infer<typeof BankAccountUpdateSchema>) {
  const { apiKey, ...rest } = input
  const changes: Record<string, unknown> = { ...rest, updatedAt: new Date() }
  if (apiKey) changes.apiKeyEnc = encryptApiKey(apiKey)
  const [row] = await db
    .update(bankAccounts)
    .set(changes)
    .where(and(eq(bankAccounts.id, id), isNull(bankAccounts.deletedAt)))
    .returning(accountColumns)
  return row ?? null
}

export async function softDeleteAccount(id: string): Promise<boolean> {
  const [row] = await db
    .update(bankAccounts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bankAccounts.id, id), isNull(bankAccounts.deletedAt)))
    .returning({ id: bankAccounts.id })
  return Boolean(row)
}

export async function listTransactions(query: z.infer<typeof TransactionsQuerySchema>) {
  const conditions: SQL[] = [isNull(bankTransactions.deletedAt)]
  if (query.accountId) conditions.push(eq(bankTransactions.bankAccountId, query.accountId))
  if (query.direction) conditions.push(eq(bankTransactions.direction, query.direction))
  if (query.unmatchedOnly) conditions.push(isNull(paymentMatches.id))

  return db
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      counterpartyName: bankTransactions.counterpartyName,
      counterpartyIban: bankTransactions.counterpartyIban,
      reference: bankTransactions.reference,
      valueDate: bankTransactions.valueDate,
      direction: bankTransactions.direction,
      match: {
        id: paymentMatches.id,
        financialRecordId: paymentMatches.financialRecordId,
        matchType: paymentMatches.matchType,
        confidence: paymentMatches.confidence,
        documentNumber: financialRecords.documentNumber,
      },
    })
    .from(bankTransactions)
    .leftJoin(paymentMatches, eq(paymentMatches.bankTransactionId, bankTransactions.id))
    .leftJoin(financialRecords, eq(financialRecords.id, paymentMatches.financialRecordId))
    .where(and(...conditions))
    .orderBy(desc(bankTransactions.valueDate))
    .limit(query.limit)
}

/** Manual match: links the transaction to the invoice and records a bank payment against the rest. */
export async function createManualMatch(bankTransactionId: string, financialRecordId: string) {
  const [txn] = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, bankTransactionId), isNull(bankTransactions.deletedAt)))
  if (!txn) throw new Error(tr('errors.reconciliation.transactionNotFound'))

  const [record] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, financialRecordId), isNull(financialRecords.deletedAt)))
  if (!record) throw new Error(tr('errors.reconciliation.recordNotFound'))

  // The amount may differ (partial payment): the payment takes min(transaction, rest) and payments.ts derives the status.
  const { match, paymentStatus } = await db.transaction(async (tx) => {
    // Under the transaction's row lock, so two matches of one transaction at once cannot both pass.
    await tx.select({ id: bankTransactions.id }).from(bankTransactions).where(eq(bankTransactions.id, bankTransactionId)).for('update')
    const [existing] = await tx
      .select({ id: paymentMatches.id })
      .from(paymentMatches)
      .where(eq(paymentMatches.bankTransactionId, bankTransactionId))
    if (existing) throw new Error(tr('errors.reconciliation.alreadyMatched'))
    const payment = await addPayment(
      financialRecordId,
      {
        amount: Math.abs(Number(txn.amount)),
        currency: txn.currency,
        paidAt: txn.valueDate,
        method: 'bank',
        reference: txn.reference,
        bankTransactionId,
      },
      { tx, capAtRemaining: true },
    )
    const [inserted] = await tx
      .insert(paymentMatches)
      .values({
        ...createdByUserId(),
        ...updatedByUserId(),
        bankTransactionId,
        financialRecordId,
        paymentId: payment.id,
        matchType: 'manual',
        confidence: '1',
      })
      .returning()
    return { match: inserted, paymentStatus: payment.paymentStatus }
  })
  await recordAudit({
    action: 'reconciliere.potrivire.manuala',
    entityType: 'payment_match',
    entityId: match?.id ?? null,
    changes: { tranzactie: [null, bankTransactionId], factura: [null, record.documentNumber ?? financialRecordId] },
  })
  // Substituie trigger-ul "auto-match" (nu există în cod azi, vezi PLAN.md Sprint 2 Open
  // Questions) — singurele evenimente reale de payment match sunt manual match + mark-paid.
  void notifyPush('paymentMatch', (locale) => ({
    title: trFor(locale, 'push.payment.matchedTitle'),
    body: trFor(locale, 'push.payment.matchedBody', { number: record.documentNumber ?? financialRecordId }),
    url: '/reconciliation',
  }))

  // Confirmare de încasare pe email — DOAR dacă plata acoperă integral factura, nu la
  // 'partial' (ar fi înșelător să trimiți "am primit plata" pt. o sumă parțială).
  if (paymentStatus === 'paid') {
    void sendPaymentConfirmationEmail(financialRecordId).catch((err) =>
      console.error(`[reconciliation] Confirmare încasare eșuată pentru ${financialRecordId}: ${String(err)}`),
    )
  }

  return match
}

/** Unmatch: deletes the link and its payment, then recomputes the invoice state from the remaining payments. */
export async function removeMatch(bankTransactionId: string): Promise<boolean> {
  const [match] = await db
    .select()
    .from(paymentMatches)
    .where(eq(paymentMatches.bankTransactionId, bankTransactionId))
  if (!match) return false

  await db.transaction(async (tx) => {
    await tx.delete(paymentMatches).where(eq(paymentMatches.id, match.id))
    if (!match.paymentId) {
      await recalculatePaymentStatus(match.financialRecordId, tx)
      return
    }
    // One payment can be referenced by several matches (backfill in migration 0091).
    const [stillReferenced] = await tx
      .select({ id: paymentMatches.id })
      .from(paymentMatches)
      .where(and(eq(paymentMatches.paymentId, match.paymentId), isNull(paymentMatches.deletedAt)))
      .limit(1)
    if (stillReferenced) return
    try {
      await removePayment(match.paymentId, { tx })
    } catch (err) {
      // The payment was already deleted from the UI: only the match is left, delete it.
      if (!(err instanceof PaymentError) || err.code !== 'PAYMENT_NOT_FOUND') throw err
      await recalculatePaymentStatus(match.financialRecordId, tx)
    }
  })
  return true
}

/** Numbered documents with an unpaid rest: the options of the manual-match dropdown. */
export async function listOpenInvoices() {
  return db
    .select({
      id: financialRecords.id,
      documentNumber: financialRecords.documentNumber,
      counterpartyName: financialRecords.counterpartyName,
      amount: financialRecords.amount,
      currency: financialRecords.currency,
      issuedAt: financialRecords.issuedAt,
      paymentStatus: financialRecords.paymentStatus,
      remaining: sql<number>`${remainingSql}::float8`.mapWith(Number),
    })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.type, 'invoice'),
        sql`NOT ${isDraftSql}`,
        sql`${remainingSql} > 0`,
      ),
    )
    .orderBy(desc(financialRecords.issuedAt))
}

/**
 * Manual "mark as paid" for cash or other channels without a bank match: an `other` payment
 * for the rest of the invoice. Triggers the same vanagreen subscription extension as the
 * automatic match, with an idempotencyKey stable on the invoice id (no payment_match here).
 */
export async function markInvoicePaidManually(financialRecordId: string) {
  const [record] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, financialRecordId), isNull(financialRecords.deletedAt)))
  if (!record) throw new Error(tr('errors.reconciliation.invoiceNotFound'))
  if (record.direction !== 'out' || record.type !== 'invoice') throw new Error(tr('errors.reconciliation.notIssuedInvoice'))

  await addPayment(
    financialRecordId,
    { amount: Number(record.amount), paidAt: new Date(), method: 'other' },
    { capAtRemaining: true },
  )
  const [updated] = await db.select().from(financialRecords).where(eq(financialRecords.id, financialRecordId))

  // Izolat (BUG-QA-MARKPAID-1, fixat): acțiunea primară — marcarea facturii ca plătită —
  // e deja commis-ă mai sus. O eroare la extinderea vanagreen nu trebuie să întoarcă un
  // răspuns de eșec pt. o acțiune care de fapt a reușit (Stefan ar vedea 400 pe o factură
  // deja marcată plătită) — logăm și continuăm, la fel ca hook-ul din bank-sync.ts.
  try {
    await maybeExtendSubscription({
      billingClientId: record.billingClientId,
      source: 'mark_paid',
      sourceId: `mark-paid:${financialRecordId}`,
    })
  } catch (err) {
    console.error('[reconciliation] extindere vanagreen eșuată pt. factura %s:', financialRecordId, err)
  }

  void notifyPush('paymentMatch', (locale) => ({
    title: trFor(locale, 'push.payment.markedPaidTitle'),
    body: trFor(locale, 'push.payment.markedPaidBody', { number: record.documentNumber ?? financialRecordId }),
    url: '/reconciliation',
  }))

  void sendPaymentConfirmationEmail(financialRecordId).catch((err) =>
    console.error(`[reconciliation] Confirmare încasare eșuată pentru ${financialRecordId}: ${String(err)}`),
  )

  return updated
}

// ── Sprint C, Track B — setări + istoric extindere abonament vanagreen ──────

export async function getVanagreenSettings() {
  return { autoExtendEnabled: await isAutoExtendEnabled() }
}

export async function updateVanagreenSettings(autoExtendEnabled: boolean) {
  await setAutoExtendEnabled(autoExtendEnabled)
  return { autoExtendEnabled }
}

export async function listVanagreenExtensionLog() {
  return db
    .select()
    .from(vanagreenExtensionLog)
    .where(isNull(vanagreenExtensionLog.deletedAt))
    .orderBy(desc(vanagreenExtensionLog.createdAt))
    .limit(100)
}

/** Pt. UI-ul de mapare billing_client ↔ tenant (sugestie fuzzy). Listă goală dacă
 * platforma vanagreen nu e configurată sau fetch-ul eșuează — UI cade pe id manual. */
export async function listVanagreenTenants() {
  try {
    return await listVanagreenTenantsForMapping()
  } catch {
    return []
  }
}

export async function checkVanagreenTenant(tenantId: string) {
  return { exists: await verifyVanagreenTenant(tenantId) }
}

// ── Revolut OAuth2 + JWT client assertion (per cont) ─────────────────────────

/**
 * Generează un certificat auto-semnat pentru contul dat: cheia privată se criptează
 * și rămâne în DB (folosită la semnarea client assertion la fiecare refresh), cheia
 * publică (certificatePem) se salvează în clar — Stefan o descarcă din UI și o
 * încarcă manual în Revolut Business Settings → API.
 */
export async function generateCertificateForAccount(id: string) {
  const { certificatePem, privateKeyPem } = await generateSelfSignedCertificate()
  await db
    .update(bankAccounts)
    .set({
      certificatePem,
      privateKeyEnc: encryptApiKey(privateKeyPem),
      updatedAt: new Date(),
    })
    .where(and(eq(bankAccounts.id, id), isNull(bankAccounts.deletedAt)))
  return { certificatePem }
}

/** Pasul 2 al consimțirii OAuth Revolut: codul din redirect e schimbat pe token-uri. */
export async function exchangeRevolutCode(id: string, code: string) {
  const [row] = await db
    .select({ clientId: bankAccounts.clientId, privateKeyEnc: bankAccounts.privateKeyEnc })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), isNull(bankAccounts.deletedAt)))
  if (!row) throw new Error(tr('errors.reconciliation.accountNotFound'))
  if (!row.clientId || !row.privateKeyEnc) {
    throw new Error(tr('errors.reconciliation.setClientIdFirst'))
  }

  const privateKeyPem = decryptApiKey(row.privateKeyEnc)
  const tokens = await exchangeCode(code, row.clientId, privateKeyPem)
  await saveRevolutTokens(id, tokens)
  return getAccount(id)
}
