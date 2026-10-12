import { and, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { billingClients, financialRecords } from '../db/schema/index.js'
import { getRateForDate } from './bnr.js'
import type { PeriodRange } from './period.js'
import { ronAmountSql } from './sql-fx.js'

/**
 * Extras din `modules/financials/service.ts` (Sprint Notițe+Wishlist+Alerts+Reports) — logica
 * de agregare P&L/cashflow reutilizată acum și de `modules/reports/service.ts`
 * (period-comparison), fără duplicare de query-uri. Comportament identic cu varianta
 * originală, doar mutată aici.
 */

function baseFilters(range: PeriodRange) {
  return [
    isNull(financialRecords.deletedAt),
    gte(financialRecords.issuedAt, range.from),
    lte(financialRecords.issuedAt, range.to),
  ]
}

export async function getPnlByMonth(range: PeriodRange) {
  const month = sql<string>`TO_CHAR(DATE_TRUNC('month', ${financialRecords.issuedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  const ronAmount = ronAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt)

  return db
    .select({
      month,
      direction: financialRecords.direction,
      paymentStatus: financialRecords.paymentStatus,
      total: sql<number>`SUM(${ronAmount})::float`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range)))
    .groupBy(month, financialRecords.direction, financialRecords.paymentStatus)
    .orderBy(month)
}

export async function getPnlByCategory(range: PeriodRange) {
  const ronAmount = ronAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt)
  const category = sql<string>`COALESCE(${financialRecords.category}, 'necategorizat')`

  return db
    .select({
      category,
      direction: financialRecords.direction,
      paymentStatus: financialRecords.paymentStatus,
      total: sql<number>`SUM(${ronAmount})::float`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range)))
    .groupBy(category, financialRecords.direction, financialRecords.paymentStatus)
    .orderBy(sql`SUM(${ronAmount}) DESC`)
}

export async function getCashflowByStatus(range: PeriodRange) {
  const ronAmount = ronAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt)
  return db
    .select({
      direction: financialRecords.direction,
      paymentStatus: financialRecords.paymentStatus,
      total: sql<number>`SUM(${ronAmount})::float`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range)))
    .groupBy(financialRecords.direction, financialRecords.paymentStatus)
}

/**
 * Totaluri P&L pe interval (venit/cheltuială/net), indiferent de paymentStatus — folosit de
 * `reports/period-comparison` pt. comparație side-by-side pe două intervale. Un singur rând,
 * SUM condiționat pe direcție (regula #9 CLAUDE.md — agregare SQL, nu JS).
 */
export async function getPnlTotals(range: PeriodRange) {
  const ronAmount = ronAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt)
  const [row] = await db
    .select({
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${financialRecords.direction} = 'out' THEN ${ronAmount} ELSE 0 END), 0)::float`,
      expense: sql<number>`COALESCE(SUM(CASE WHEN ${financialRecords.direction} = 'in' THEN ${ronAmount} ELSE 0 END), 0)::float`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range)))

  const revenue = row?.revenue ?? 0
  const expense = row?.expense ?? 0
  return { revenue, expense, net: revenue - expense }
}

/**
 * MRR curent (recurring revenue LIVE din billing_clients, nu istoric — nu există un
 * snapshot lunar de MRR stocat nicăieri, vezi nota din connectors/vanagreen/transform.ts:
 * `mrr` a dispărut din platform_metrics odată cu Sprint C, Track B). Extrasă din
 * `modules/financials/service.ts` (getRecurringRevenue) — reutilizată acum și de
 * `modules/reports/service.ts` (mrr-trend expune valoarea curentă alături de trendul
 * real de active_clients/demo_clients din platform_metrics). Comportament identic,
 * doar mutată aici ca `financials` și `reports` să nu se cross-importe (regula #5 CLAUDE.md).
 */
/**
 * Serie zilnică de venit real (facturi emise + încasate) — direction='out',
 * paymentStatus='paid', grupat pe zi. Folosită de Overview pt. graficul de Venituri,
 * ca să nu mai depindă de platform_metrics.revenue (nimeni nu-l mai populează de la
 * Sprint C, Track B — vezi connectors/vanagreen/transform.ts). Aceeași definiție de
 * "venit realizat" ca getPnlByMonth/sumByDirection din FinancialsPage.
 */
export async function getDailyPaidRevenue(range: PeriodRange) {
  const day = sql<string>`TO_CHAR(DATE_TRUNC('day', ${financialRecords.issuedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  const ronAmount = ronAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt)

  return db
    .select({
      date: day,
      value: sql<number>`SUM(${ronAmount})::float`,
    })
    .from(financialRecords)
    .where(
      and(
        ...baseFilters(range),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.paymentStatus, 'paid'),
      ),
    )
    .groupBy(day)
    .orderBy(day)
}

export async function getCurrentMrr() {
  // `billingCycle='annual'`: subscriptionPriceLei/Eur e prețul FACTURAT PE AN, nu pe lună —
  // normalizat /12 ca să reflecte contribuția lunară reală. `billingCycle=null` (one-shot,
  // billingDueDate nu se mai rostogolește niciodată — vezi jobs/billing-cycle-rollover.ts)
  // e exclus complet: nu e venit recurent, indiferent de autoInvoiceEnabled.
  const rows = await db
    .select({
      currency: billingClients.subscriptionPriceCurrency,
      total: sql<string>`COALESCE(SUM(CASE
        WHEN ${billingClients.subscriptionPriceCurrency} = 'lei' THEN ${billingClients.subscriptionPriceLei}::numeric
        ELSE ${billingClients.subscriptionPriceEur}::numeric
      END / CASE WHEN ${billingClients.billingCycle} = 'annual' THEN 12 ELSE 1 END), 0)`,
    })
    .from(billingClients)
    .where(
      and(
        isNull(billingClients.deletedAt),
        eq(billingClients.autoInvoiceEnabled, true),
        isNotNull(billingClients.billingCycle),
      ),
    )
    .groupBy(billingClients.subscriptionPriceCurrency)

  let mrrLei = Number(rows.find((r) => r.currency === 'lei')?.total ?? 0)
  const mrrEur = Number(rows.find((r) => r.currency === 'eur')?.total ?? 0)

  if (mrrEur > 0) {
    try {
      const todayIso = new Date().toISOString().slice(0, 10)
      const rateRow = await getRateForDate(todayIso)
      mrrLei += mrrEur * Number(rateRow.rate)
    } catch {
      // BNR jos — întoarce ce poate (partea în lei), fără conversia EUR→lei de data asta.
    }
  }

  return {
    mrrLei: Math.round(mrrLei * 100) / 100,
    mrrEur: Math.round(mrrEur * 100) / 100,
  }
}
