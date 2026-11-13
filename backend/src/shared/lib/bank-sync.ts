import { and, eq, isNull, sql as rawSql } from 'drizzle-orm'
import { getBankConnector } from '../../connectors/index.js'
import { maybeExtendSubscription } from '../../modules/reconciliation/vanagreen-extension.js'
import { db } from '../db/client.js'
import {
  bankAccounts,
  bankTransactions,
  billingClients,
  financialRecords,
  paymentMatches,
  syncLog,
} from '../db/schema/index.js'
import { rollBillingDueDateOnPayment } from './billing-rollover.js'
import { decryptApiKey } from './crypto.js'
import { AUTO_MATCH_THRESHOLD, scoreMatch } from './matching.js'
import { sendPaymentConfirmationEmail } from './payment-confirmation.js'
import { addPayment, isDraftSql, PaymentError, remainingSql } from './payments.js'

type BankAccountRow = typeof bankAccounts.$inferSelect

/** Overlap la sync incremental — prindem tranzacții settle-uite târziu; upsert-ul deduplică. */
const SYNC_OVERLAP_MS = 3 * 24 * 60 * 60 * 1000
const INITIAL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Sync-ul unui cont bancar cu failure izolat (pattern identic cu runConnectorSync):
 * orice eroare ajunge în sync_log ca FAILED și NU se propagă.
 */
export async function runBankSync(account: BankAccountRow): Promise<void> {
  const [log] = await db
    .insert(syncLog)
    .values({ jobKey: `bank:${account.id}`, status: 'RUNNING' })
    .returning()
  if (!log) throw new Error('Failed to create sync_log entry')

  try {
    const connector = getBankConnector(account.provider)
    // Hook opțional per-connector: providerii OAuth2 (Revolut) își gestionează
    // singuri refresh-ul de sesiune; restul cad pe api_key_enc static (regula #3 —
    // zero `if (provider === 'revolut')` aici, doar consumăm interfața generică).
    const session = connector.prepareSession
      ? await connector.prepareSession(account.id)
      : { accessToken: decryptApiKey(account.apiKeyEnc as string) }
    const accountConfig = {
      id: account.id,
      provider: account.provider,
      name: account.name,
      accountRef: account.accountRef,
      currency: account.currency,
      accessToken: session.accessToken,
    }
    const to = new Date()
    const from = account.lastSyncAt
      ? new Date(account.lastSyncAt.getTime() - SYNC_OVERLAP_MS)
      : new Date(to.getTime() - INITIAL_WINDOW_MS)

    const transactions = await connector.fetchTransactions(accountConfig, from, to)
    if (transactions.length > 0) {
      await db
        .insert(bankTransactions)
        .values(
          transactions.map((t) => ({
            bankAccountId: account.id,
            externalId: t.externalId,
            amount: String(t.amount),
            currency: t.currency,
            counterpartyName: t.counterpartyName,
            counterpartyIban: t.counterpartyIban,
            reference: t.reference,
            valueDate: t.valueDate,
            direction: t.direction,
            rawMeta: t.rawMeta,
          })),
        )
        .onConflictDoUpdate({
          target: [bankTransactions.bankAccountId, bankTransactions.externalId],
          set: {
            amount: rawSql`EXCLUDED.amount`,
            reference: rawSql`EXCLUDED.reference`,
            valueDate: rawSql`EXCLUDED.value_date`,
            updatedAt: new Date(),
          },
        })
    }

    await autoMatchTransactions()

    const health = await connector.checkHealth(accountConfig)
    await db
      .update(syncLog)
      .set({ status: 'SUCCESS', recordsSync: transactions.length, finishedAt: new Date() })
      .where(eq(syncLog.id, log.id))
    await db
      .update(bankAccounts)
      .set({ healthStatus: health.status, lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(bankAccounts.id, account.id))
  } catch (err) {
    await db
      .update(syncLog)
      .set({ status: 'FAILED', errorMessage: String(err), finishedAt: new Date() })
      .where(eq(syncLog.id, log.id))
    await db
      .update(bankAccounts)
      .set({ healthStatus: 'down', updatedAt: new Date() })
      .where(eq(bankAccounts.id, account.id))
  }
}

/**
 * Automatic matching: unmatched 'in' transactions x numbered issued invoices with an unpaid rest.
 * Only above AUTO_MATCH_THRESHOLD; the rest is left for manual matching.
 * A match creates a bank payment (payments.ts) that decides the invoice state; unmatching
 * from the UI deletes the payment and the state is recomputed.
 */
export async function autoMatchTransactions(): Promise<number> {
  const unmatched = await db
    .select({
      id: bankTransactions.id,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      counterpartyName: bankTransactions.counterpartyName,
      counterpartyIban: bankTransactions.counterpartyIban,
      reference: bankTransactions.reference,
      valueDate: bankTransactions.valueDate,
    })
    .from(bankTransactions)
    .leftJoin(paymentMatches, eq(paymentMatches.bankTransactionId, bankTransactions.id))
    .where(
      and(
        isNull(paymentMatches.id),
        isNull(bankTransactions.deletedAt),
        eq(bankTransactions.direction, 'in'),
      ),
    )

  if (unmatched.length === 0) return 0

  const openInvoices = await db
    .select({
      id: financialRecords.id,
      // The balance, not the invoice total: a partly paid invoice is matched by the transaction for the rest.
      remaining: rawSql<number>`${remainingSql}::float8`.mapWith(Number),
      currency: financialRecords.currency,
      documentNumber: financialRecords.documentNumber,
      counterpartyName: financialRecords.counterpartyName,
      clientIban: billingClients.iban,
      billingClientId: financialRecords.billingClientId,
      issuedAt: financialRecords.issuedAt,
    })
    .from(financialRecords)
    .leftJoin(billingClients, eq(billingClients.id, financialRecords.billingClientId))
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.type, 'invoice'),
        rawSql`NOT ${isDraftSql}`,
        rawSql`${remainingSql} > 0`,
      ),
    )

  let matched = 0
  const claimedInvoices = new Set<string>()

  for (const txn of unmatched) {
    let best: { invoiceId: string; billingClientId: string | null; issuedAt: Date; score: number } | null = null
    for (const invoice of openInvoices) {
      if (claimedInvoices.has(invoice.id)) continue
      const score = scoreMatch(
        {
          amount: Number(txn.amount),
          currency: txn.currency,
          counterpartyIban: txn.counterpartyIban,
          counterpartyName: txn.counterpartyName,
          reference: txn.reference,
        },
        {
          amount: invoice.remaining,
          currency: invoice.currency,
          documentNumber: invoice.documentNumber,
          counterpartyName: invoice.counterpartyName,
          clientIban: invoice.clientIban,
        },
      )
      if (score >= AUTO_MATCH_THRESHOLD && (!best || score > best.score)) {
        best = { invoiceId: invoice.id, billingClientId: invoice.billingClientId, issuedAt: invoice.issuedAt, score }
      }
    }
    if (best) {
      let match: typeof paymentMatches.$inferSelect | undefined
      try {
        match = await db.transaction(async (tx) => {
          // A manual match of this transaction may have landed since the unmatched list was read.
          await tx.select({ id: bankTransactions.id }).from(bankTransactions).where(eq(bankTransactions.id, txn.id)).for('update')
          const [taken] = await tx.select({ id: paymentMatches.id }).from(paymentMatches).where(eq(paymentMatches.bankTransactionId, txn.id))
          if (taken) return undefined
          const payment = await addPayment(
            best.invoiceId,
            {
              amount: Math.abs(Number(txn.amount)),
              currency: txn.currency,
              paidAt: txn.valueDate,
              method: 'bank',
              reference: txn.reference,
              bankTransactionId: txn.id,
            },
            { tx, capAtRemaining: true },
          )
          const [inserted] = await tx
            .insert(paymentMatches)
            .values({
              bankTransactionId: txn.id,
              financialRecordId: best.invoiceId,
              paymentId: payment.id,
              matchType: 'auto',
              confidence: best.score.toFixed(3),
            })
            .returning()
          return inserted
        })
      } catch (err) {
        // A payment added from the UI between the query and here can leave nothing to pay; the transaction stays for a manual match.
        if (err instanceof PaymentError) {
          console.error(`[bank-sync] auto-match skipped for transaction ${txn.id}: ${err.code}`)
          continue
        }
        throw err
      }
      if (!match) continue
      claimedInvoices.add(best.invoiceId)
      matched++

      // Rostogolire billingDueDate — vezi shared/lib/billing-rollover.ts. Bug real (Stefan,
      // 2026-08-01): match-ul automat seta paymentStatus='paid' direct, fără să treacă prin
      // modules/accounting/service.ts updatePayment (unde era fix-ul inițial) — un client
      // plătit prin reconciliere bancară automată rămânea cu aceeași "Scadență curentă" până
      // a doua zi, la fel ca marcarea manuală înainte de fix.
      if (best.billingClientId) {
        try {
          await rollBillingDueDateOnPayment(best.billingClientId, best.issuedAt)
        } catch (err) {
          console.error(`[bank-sync] rostogolire billingDueDate eșuată pt. clientul ${best.billingClientId}:`, err)
        }
      }

      // Extindere abonament vanagreen (Sprint C, Track B) — no-op silențios dacă
      // clientul nu e mapat; niciodată nu blochează match-ul bancar în sine. try/catch
      // explicit (BUG-QA-BANKSYNC-1/2, fixat): match-ul + paymentStatus sunt deja
      // commis mai sus — o eroare aici nu trebuie nici să marcheze tot sync-ul FAILED,
      // nici să oprească bucla înainte de restul tranzacțiilor din același batch.
      if (match) {
        try {
          await maybeExtendSubscription({
            billingClientId: best.billingClientId,
            source: 'auto_match',
            sourceId: match.id,
          })
        } catch (err) {
          console.error(`[bank-sync] extindere vanagreen eșuată pt. match ${match.id}:`, err)
        }
      }

      // Confirmare de încasare pe email — fire-and-forget, izolat per tranzacție: un eșec
      // de email la un match din batch nu oprește procesarea restului tranzacțiilor.
      void sendPaymentConfirmationEmail(best.invoiceId).catch((err) =>
        console.error(`[bank-sync] confirmare încasare eșuată pt. factura ${best.invoiceId}:`, err),
      )
    }
  }
  return matched
}
