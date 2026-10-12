import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
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
import { saveRevolutTokens } from '../../shared/lib/revolut.js'
import type { BankAccountCreateSchema, BankAccountUpdateSchema, TransactionsQuerySchema } from './schema.js'
import {
  isAutoExtendEnabled,
  listVanagreenTenantsForMapping,
  maybeExtendSubscription,
  setAutoExtendEnabled,
  verifyVanagreenTenant,
} from './vanagreen-extension.js'

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

/** Match manual: leagă tranzacția de factură și marchează factura plătită. */
export async function createManualMatch(bankTransactionId: string, financialRecordId: string) {
  const [txn] = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, bankTransactionId), isNull(bankTransactions.deletedAt)))
  if (!txn) throw new Error('Tranzacție inexistentă')

  const [record] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, financialRecordId), isNull(financialRecords.deletedAt)))
  if (!record) throw new Error('Factura/înregistrarea nu există')

  const [existing] = await db
    .select({ id: paymentMatches.id })
    .from(paymentMatches)
    .where(eq(paymentMatches.bankTransactionId, bankTransactionId))
  if (existing) throw new Error('Tranzacția e deja matchuită — fă unmatch întâi')

  // Suma poate diferi (plată parțială) — partial dacă tranzacția acoperă mai puțin.
  const paymentStatus = Number(txn.amount) + 0.005 >= Number(record.amount) ? 'paid' : 'partial'
  const match = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(paymentMatches)
      .values({
        ...createdByUserId(),
        ...updatedByUserId(),
        bankTransactionId,
        financialRecordId,
        matchType: 'manual',
        confidence: '1',
      })
      .returning()
    await tx
      .update(financialRecords)
      .set({
        paymentStatus,
        paidAt: paymentStatus === 'paid' ? txn.valueDate : null,
        updatedAt: new Date(),
        ...updatedByUserId(),
      })
      .where(eq(financialRecords.id, financialRecordId))
    return inserted
  })
  await recordAudit({
    action: 'reconciliere.potrivire.manuala',
    entityType: 'payment_match',
    entityId: match?.id ?? null,
    changes: { tranzactie: [null, bankTransactionId], factura: [null, record.documentNumber ?? financialRecordId] },
  })
  // Substituie trigger-ul "auto-match" (nu există în cod azi, vezi PLAN.md Sprint 2 Open
  // Questions) — singurele evenimente reale de payment match sunt manual match + mark-paid.
  void notifyPush('paymentMatch', {
    title: 'Plată matchuită',
    body: `Factura ${record.documentNumber ?? financialRecordId} a fost matchuită cu o tranzacție bancară.`,
    url: '/reconciliation',
  })

  // Confirmare de încasare pe email — DOAR dacă plata acoperă integral factura, nu la
  // 'partial' (ar fi înșelător să trimiți "am primit plata" pt. o sumă parțială).
  if (paymentStatus === 'paid') {
    void sendPaymentConfirmationEmail(financialRecordId).catch((err) =>
      console.error(`[reconciliation] Confirmare încasare eșuată pentru ${financialRecordId}: ${String(err)}`),
    )
  }

  return match
}

/** Unmatch: șterge legătura și readuce înregistrarea la unpaid. */
export async function removeMatch(bankTransactionId: string): Promise<boolean> {
  const [match] = await db
    .select()
    .from(paymentMatches)
    .where(eq(paymentMatches.bankTransactionId, bankTransactionId))
  if (!match) return false

  await db.transaction(async (tx) => {
    await tx.delete(paymentMatches).where(eq(paymentMatches.id, match.id))
    await tx
      .update(financialRecords)
      .set({ paymentStatus: 'unpaid', paidAt: null, updatedAt: new Date() })
      .where(eq(financialRecords.id, match.financialRecordId))
  })
  return true
}

/** Facturile deschise — opțiunile pentru dropdown-ul de matching manual din UI. */
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
    })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.type, 'invoice'),
        isNull(financialRecords.paidAt),
      ),
    )
    .orderBy(desc(financialRecords.issuedAt))
}

/**
 * "Marchează plătit" manual — pt. plăți cash/alt canal, fără match bancar. Declanșează
 * exact același cod ca match-ul automat pt. extinderea abonamentului vanagreen
 * (Sprint C, Track B), cu idempotencyKey stabil pe id-ul facturii (nu există
 * payment_match în acest flux).
 */
export async function markInvoicePaidManually(financialRecordId: string) {
  const [record] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, financialRecordId), isNull(financialRecords.deletedAt)))
  if (!record) throw new Error('Factura nu există')
  if (record.direction !== 'out' || record.type !== 'invoice') throw new Error('Nu e o factură emisă')

  const [updated] = await db
    .update(financialRecords)
    .set({ paymentStatus: 'paid', paidAt: new Date(), updatedAt: new Date() })
    .where(eq(financialRecords.id, financialRecordId))
    .returning()

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
    console.error(`[reconciliation] extindere vanagreen eșuată pt. factura ${financialRecordId}:`, err)
  }

  void notifyPush('paymentMatch', {
    title: 'Factură marcată plătită',
    body: `Factura ${record.documentNumber ?? financialRecordId} a fost marcată plătită manual.`,
    url: '/reconciliation',
  })

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
  if (!row) throw new Error('Cont bancar inexistent')
  if (!row.clientId || !row.privateKeyEnc) {
    throw new Error('Setează client_id și generează certificatul înainte de a face schimbul de cod')
  }

  const privateKeyPem = decryptApiKey(row.privateKeyEnc)
  const tokens = await exchangeCode(code, row.clientId, privateKeyPem)
  await saveRevolutTokens(id, tokens)
  return getAccount(id)
}
