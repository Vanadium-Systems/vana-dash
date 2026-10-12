import cron from 'node-cron'
import { and, desc, eq, isNull, like, lt, sql } from 'drizzle-orm'
import { generateD301Preview, generateD390Preview } from '../modules/accounting/d301.js'
import { db } from '../shared/db/client.js'
import {
  alertRules,
  alerts,
  anafCredentials,
  bankAccounts,
  bankTransactions,
  financialRecords,
  paymentMatches,
  syncLog,
} from '../shared/db/schema/index.js'
import { sendAlertEmail } from '../shared/lib/email.js'
import { notifyPush } from '../shared/lib/push.js'

// Alertele de accounting (event-based, nu threshold pe metrici): reguli seed-uite
// în alert_rules cu metric_key 'accounting.<key>'; instanțele intră în alerts.
// Dedup: nu re-emitem cât timp există o alertă neconfirmată cu același mesaj.

const CRON_EXPR = '0 8 * * *'
const TOKEN_EXPIRING_DAYS = 7
const UNMATCHED_TXN_DAYS = 7

// Estimări pentru expirarea refresh token-urilor (nu access token-urile, alea
// au deja alertă la #2 prin `expiresAt`). Nici anaf_credentials, nici
// bank_accounts nu au o coloană dedicată "refresh token issued/expires at" —
// presupunem că `lastRefreshedAt` marchează și momentul de la care refresh
// token-ul curent e valabil (ambele provideri par să roteze refresh token-ul
// la fiecare refresh reușit, comportament OAuth comun). Dacă presupunerea
// asta se dovedește greșită empiric, e nevoie de o coloană dedicată — nu o
// adăugăm aici, doar semnalăm limitarea (vezi raportul de sprint).
const ANAF_REFRESH_TOKEN_LIFETIME_DAYS = 365
const ANAF_REFRESH_TOKEN_WARNING_DAYS = 30
const REVOLUT_REFRESH_TOKEN_LIFETIME_DAYS = 90
const REVOLUT_REFRESH_TOKEN_WARNING_DAYS = 7 // fereastră 4x mai mică decât ANAF → prag proporțional mai mic
const D301_REMINDER_DAY = 20 // termen depunere D301/D390: 25 luna curentă, pt. luna precedentă

const ACCOUNTING_RULES = [
  { key: 'accounting.invoice_overdue', name: 'Factură emisă restantă', severity: 'warning' as const },
  { key: 'accounting.anaf_token_expiring', name: 'Token ANAF aproape de expirare', severity: 'warning' as const },
  { key: 'accounting.anaf_upload_rejected', name: 'e-Factura respinsă de ANAF', severity: 'critical' as const },
  // email: false — cerere Stefan (2026-09-14): sync bancar rămâne doar alertă în-app + push.
  { key: 'accounting.bank_sync_failed', name: 'Sync bancar eșuat', severity: 'warning' as const, email: false },
  { key: 'accounting.unmatched_transaction', name: 'Tranzacție nematchuită', severity: 'info' as const },
  {
    key: 'accounting.anaf_refresh_token_expiring',
    name: 'Refresh token ANAF aproape de expirare (estimat)',
    severity: 'warning' as const,
  },
  {
    key: 'accounting.revolut_refresh_token_expiring',
    name: 'Refresh token Revolut aproape de expirare (estimat)',
    severity: 'warning' as const,
  },
  { key: 'accounting.d301_deadline_approaching', name: 'Termen D301 se apropie', severity: 'warning' as const },
  { key: 'accounting.d390_deadline_approaching', name: 'Termen D390 se apropie', severity: 'warning' as const },
]

export function startAccountingAlertsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void checkAccountingAlerts().catch((err) => console.error(`[accounting-alerts] ${String(err)}`))
  })
  console.log(`[accounting-alerts] Scheduled (${CRON_EXPR})`)
}

async function ensureRules(): Promise<Map<string, { id: string; severity: string; email: boolean; enabled: boolean }>> {
  const result = new Map<string, { id: string; severity: string; email: boolean; enabled: boolean }>()
  for (const rule of ACCOUNTING_RULES) {
    const email = rule.email ?? true
    const [existing] = await db
      .select({ id: alertRules.id, enabled: alertRules.enabled, severity: alertRules.severity })
      .from(alertRules)
      .where(and(eq(alertRules.metricKey, rule.key), isNull(alertRules.deletedAt)))
    if (existing) {
      // Severitatea efectivă e cea din ACCOUNTING_RULES; o aliniem și în DB ca Alerte → Reguli
      // să nu afișeze default-ul coloanei ('warning') pt. reguli create înainte de fix.
      if (existing.severity !== rule.severity) {
        await db.update(alertRules).set({ severity: rule.severity, updatedAt: new Date() }).where(eq(alertRules.id, existing.id))
      }
      result.set(rule.key, { id: existing.id, severity: rule.severity, email, enabled: existing.enabled })
      continue
    }
    // condition/threshold sunt N/A pentru alertele event-based — valori neutre.
    const [created] = await db
      .insert(alertRules)
      .values({ name: rule.name, metricKey: rule.key, condition: 'gt', threshold: '0', severity: rule.severity })
      .returning({ id: alertRules.id })
    if (created) result.set(rule.key, { id: created.id, severity: rule.severity, email, enabled: true })
  }
  return result
}

// Respectă `alert_rules.enabled` (2026-09-21, vezi nota din shared/lib/alerting.ts — același
// checkbox mort din Alerts → Reguli, fixat aici în paralel pt. namespace-ul accounting.*).
async function raiseAlert(
  rules: Map<string, { id: string; severity: string; email: boolean; enabled: boolean }>,
  ruleKey: string,
  message: string,
): Promise<void> {
  const rule = rules.get(ruleKey)
  if (!rule || !rule.enabled) return
  const [existing] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.ruleId, rule.id), eq(alerts.message, message), isNull(alerts.acknowledgedAt)))
  if (existing) return

  await db.insert(alerts).values({
    ruleId: rule.id,
    severity: rule.severity as 'info' | 'warning' | 'critical',
    message,
  })
  if (rule.email) await sendAlertEmail(message, `${message}\n\nDetalii în vana-dash → Accounting.`)
  // Unificat cu metric-alerts.ts — același eventType 'alerts' pt. GET /api/alerts, indiferent
  // de sursă (threshold pe metrici sau event-based accounting).
  void notifyPush('alerts', { title: 'Alertă vana-dash', body: message, url: '/alerts' })
}

export async function checkAccountingAlerts(): Promise<void> {
  const rules = await ensureRules()
  const now = new Date()

  // 1. invoice_overdue — facturi emise cu scadența depășită și neplătite.
  const overdue = await db
    .select({
      documentNumber: financialRecords.documentNumber,
      counterpartyName: financialRecords.counterpartyName,
      amount: financialRecords.amount,
      currency: financialRecords.currency,
    })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.type, 'invoice'),
        lt(financialRecords.dueAt, now),
        sql`${financialRecords.paymentStatus} <> 'paid'`,
      ),
    )
  for (const invoice of overdue) {
    await raiseAlert(
      rules,
      'accounting.invoice_overdue',
      `Factura ${invoice.documentNumber ?? '(draft)'} către ${invoice.counterpartyName ?? '?'} e restantă (${invoice.amount} ${invoice.currency})`,
    )
  }

  // 2. anaf_token_expiring — expiră în <7 zile sau necesită deja re-auth.
  const [creds] = await db.select().from(anafCredentials).where(isNull(anafCredentials.deletedAt)).limit(1)
  if (creds?.status === 'needs_reauth') {
    await raiseAlert(rules, 'accounting.anaf_token_expiring', 'ANAF necesită reautentificare manuală')
  } else if (
    creds?.status === 'active' &&
    creds.expiresAt &&
    creds.expiresAt.getTime() - now.getTime() < TOKEN_EXPIRING_DAYS * 24 * 60 * 60 * 1000
  ) {
    await raiseAlert(
      rules,
      'accounting.anaf_token_expiring',
      `Token-ul ANAF expiră la ${creds.expiresAt.toISOString().slice(0, 10)}`,
    )
  }

  // 3. anaf_upload_rejected — facturi respinse (poll-ul trimite email imediat;
  // aici doar ne asigurăm că există și o alertă vizibilă în dashboard).
  const rejected = await db
    .select({ documentNumber: financialRecords.documentNumber })
    .from(financialRecords)
    .where(and(isNull(financialRecords.deletedAt), eq(financialRecords.anafStatus, 'rejected')))
  for (const invoice of rejected) {
    await raiseAlert(
      rules,
      'accounting.anaf_upload_rejected',
      `e-Factura ${invoice.documentNumber ?? '?'} a fost respinsă de ANAF`,
    )
  }

  // 4. bank_sync_failed — ultimul sync al vreunui cont bancar a eșuat.
  const lastBankSyncs = await db
    .select({ jobKey: syncLog.jobKey, status: syncLog.status, errorMessage: syncLog.errorMessage })
    .from(syncLog)
    .where(like(syncLog.jobKey, 'bank:%'))
    .orderBy(desc(syncLog.startedAt))
    .limit(20)
  const seen = new Set<string>()
  for (const entry of lastBankSyncs) {
    if (!entry.jobKey || seen.has(entry.jobKey)) continue
    seen.add(entry.jobKey)
    if (entry.status === 'FAILED') {
      await raiseAlert(rules, 'accounting.bank_sync_failed', `Sync bancar eșuat (${entry.jobKey})`)
    }
  }

  // 5. unmatched_transaction — încasări mai vechi de N zile fără match.
  const staleCutoff = new Date(now.getTime() - UNMATCHED_TXN_DAYS * 24 * 60 * 60 * 1000)
  const unmatched = await db
    .select({
      id: bankTransactions.id,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      counterpartyName: bankTransactions.counterpartyName,
    })
    .from(bankTransactions)
    .leftJoin(paymentMatches, eq(paymentMatches.bankTransactionId, bankTransactions.id))
    .where(
      and(
        isNull(paymentMatches.id),
        isNull(bankTransactions.deletedAt),
        eq(bankTransactions.direction, 'in'),
        lt(bankTransactions.valueDate, staleCutoff),
      ),
    )
  for (const txn of unmatched) {
    // Dedup-ul pe mesaj (raiseAlert) ar confunda 2 tranzacții distincte cu aceeași
    // sumă+contraparte — includem un fragment din id ca mesajul să rămână unic per
    // tranzacție (BUG-QA1, semnalat de QA în Wave 3).
    await raiseAlert(
      rules,
      'accounting.unmatched_transaction',
      `Încasare nematchuită de ${UNMATCHED_TXN_DAYS}+ zile: ${txn.amount} ${txn.currency} de la ${txn.counterpartyName ?? '?'} (#${txn.id.slice(0, 8)})`,
    )
  }

  // 6. anaf_refresh_token_expiring — estimare pe baza lastRefreshedAt (vezi notă
  // la ANAF_REFRESH_TOKEN_LIFETIME_DAYS). Doar dacă statusul e activ — needs_reauth
  // e deja acoperit de alerta #2.
  if (creds?.status === 'active' && creds.lastRefreshedAt) {
    const estimatedExpiry = new Date(
      creds.lastRefreshedAt.getTime() + ANAF_REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
    )
    if (estimatedExpiry.getTime() - now.getTime() < ANAF_REFRESH_TOKEN_WARNING_DAYS * 24 * 60 * 60 * 1000) {
      await raiseAlert(
        rules,
        'accounting.anaf_refresh_token_expiring',
        `Refresh token-ul ANAF expiră probabil în jur de ${estimatedExpiry.toISOString().slice(0, 10)} (estimare, fără reautentificare manuală riscăm needs_reauth)`,
      )
    }
  }

  // 7. revolut_refresh_token_expiring — analog, per cont bancar Revolut activ.
  const revolutAccounts = await db
    .select({ id: bankAccounts.id, name: bankAccounts.name, lastRefreshedAt: bankAccounts.lastRefreshedAt })
    .from(bankAccounts)
    .where(
      and(eq(bankAccounts.provider, 'revolut'), eq(bankAccounts.authStatus, 'active'), isNull(bankAccounts.deletedAt)),
    )
  for (const account of revolutAccounts) {
    if (!account.lastRefreshedAt) continue
    const estimatedExpiry = new Date(
      account.lastRefreshedAt.getTime() + REVOLUT_REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
    )
    if (estimatedExpiry.getTime() - now.getTime() < REVOLUT_REFRESH_TOKEN_WARNING_DAYS * 24 * 60 * 60 * 1000) {
      await raiseAlert(
        rules,
        'accounting.revolut_refresh_token_expiring',
        `Refresh token-ul Revolut pentru contul „${account.name}" expiră probabil în jur de ${estimatedExpiry.toISOString().slice(0, 10)} (estimare)`,
      )
    }
  }

  // 8. d301_deadline_approaching / d390_deadline_approaching — termen 25 luna curentă
  // pt. luna precedentă. Fără coloană "depus" în DB (niciun API de upload direct —
  // depunerea e manuală prin SPV/e-guvernare cu certificat calificat), deci alerta
  // rămâne activă (dedup pe mesaj, ca la celelalte) până e confirmată manual de Stefan
  // după depunere — nu urmărim automat dacă a fost efectiv depusă.
  if (now.getUTCDate() >= D301_REMINDER_DAY) {
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const prevPeriod = prevMonth.toISOString().slice(0, 7)
    const [d301Preview, d390Preview] = await Promise.all([
      generateD301Preview(prevPeriod),
      generateD390Preview(prevPeriod),
    ])
    if (d301Preview.lines.length > 0) {
      await raiseAlert(
        rules,
        'accounting.d301_deadline_approaching',
        `D301 pentru ${prevPeriod} are ${d301Preview.lines.length} linii de depus — termen 25 luna curentă`,
      )
    }
    if (d390Preview.lines.length > 0) {
      await raiseAlert(
        rules,
        'accounting.d390_deadline_approaching',
        `D390 pentru ${prevPeriod} are ${d390Preview.lines.length} linii de depus — termen 25 luna curentă`,
      )
    }
  }
}
