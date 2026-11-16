import { and, eq, gte, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { billingClients, financialRecords, platforms } from '../db/schema/index.js'
import { getRateForDate } from './bnr.js'
import type { PeriodRange } from './period.js'
import { displayMoney } from './display-money.js'
import { displayAmountSql } from './sql-fx.js'

// Totals come back in the display currency of the request (`displayMoney`): RON unless the
// person chose EUR or USD. A job has no request, so it gets the installation's default.

/**
 * Extras din `modules/financials/service.ts` (Sprint Notițe+Wishlist+Alerts+Reports) — logica
 * de agregare P&L/cashflow reutilizată acum și de `modules/reports/service.ts`
 * (period-comparison), fără duplicare de query-uri. Comportament identic cu varianta
 * originală, doar mutată aici.
 */

/** A click on a breakdown row narrows the whole Financials page to that slice. */
export interface RecordFilter {
  kind: 'category' | 'platform' | 'client'
  id: string
}

// One key per client, whether the record is linked to a billing client or only names the counterparty.
const clientKey = sql<string>`COALESCE(${financialRecords.billingClientId}::text, ${financialRecords.counterpartyCif}, ${financialRecords.counterpartyName}, '-')`
const categoryKey = sql<string>`COALESCE(${financialRecords.category}, 'necategorizat')`

function filterSql(filter?: RecordFilter) {
  if (!filter) return []
  if (filter.kind === 'category') return [sql`${categoryKey} = ${filter.id}`]
  if (filter.kind === 'platform') return [sql`${financialRecords.platformId}::text = ${filter.id}`]
  return [sql`${clientKey} = ${filter.id}`]
}

function baseFilters(range: PeriodRange, filter?: RecordFilter) {
  return [
    isNull(financialRecords.deletedAt),
    // A proforma is an offer, not revenue.
    ne(financialRecords.type, 'proforma'),
    gte(financialRecords.issuedAt, range.from),
    lte(financialRecords.issuedAt, range.to),
    ...filterSql(filter),
  ]
}

export async function getPnlByMonth(range: PeriodRange, filter?: RecordFilter) {
  const month = sql<string>`TO_CHAR(DATE_TRUNC('month', ${financialRecords.issuedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)

  return db
    .select({
      month,
      direction: financialRecords.direction,
      paymentStatus: financialRecords.paymentStatus,
      total: sql<number>`SUM(${displayAmount})::float`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range, filter)))
    .groupBy(month, financialRecords.direction, financialRecords.paymentStatus)
    .orderBy(month)
}

export async function getPnlByCategory(range: PeriodRange, filter?: RecordFilter) {
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)
  const category = categoryKey

  return db
    .select({
      category,
      direction: financialRecords.direction,
      paymentStatus: financialRecords.paymentStatus,
      total: sql<number>`SUM(${displayAmount})::float`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range, filter)))
    .groupBy(category, financialRecords.direction, financialRecords.paymentStatus)
    .orderBy(sql`SUM(${displayAmount}) DESC`)
}

export async function getCashflowByStatus(range: PeriodRange, filter?: RecordFilter) {
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)
  return db
    .select({
      direction: financialRecords.direction,
      paymentStatus: financialRecords.paymentStatus,
      total: sql<number>`SUM(${displayAmount})::float`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range, filter)))
    .groupBy(financialRecords.direction, financialRecords.paymentStatus)
}

/**
 * Totaluri P&L pe interval (venit/cheltuială/net), indiferent de paymentStatus — folosit de
 * `reports/period-comparison` pt. comparație side-by-side pe două intervale. Un singur rând,
 * SUM condiționat pe direcție (regula #9 CLAUDE.md — agregare SQL, nu JS).
 */
export async function getPnlTotals(range: PeriodRange, filter?: RecordFilter) {
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)
  const [row] = await db
    .select({
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${financialRecords.direction} = 'out' THEN ${displayAmount} ELSE 0 END), 0)::float`,
      expense: sql<number>`COALESCE(SUM(CASE WHEN ${financialRecords.direction} = 'in' THEN ${displayAmount} ELSE 0 END), 0)::float`,
    })
    .from(financialRecords)
    .where(and(...baseFilters(range, filter)))

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
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)

  return db
    .select({
      date: day,
      value: sql<number>`SUM(${displayAmount})::float`,
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

/** Revenue issued per client in the period, largest first (the ranked bars on Financials). */
export async function getRevenueByClient(range: PeriodRange, filter?: RecordFilter, limit = 10) {
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)
  return db
    .select({
      id: clientKey,
      name: sql<string>`COALESCE(MAX(${billingClients.name}), MAX(${financialRecords.counterpartyName}), '-')`,
      total: sql<number>`SUM(${displayAmount})::float`,
    })
    .from(financialRecords)
    .leftJoin(billingClients, eq(billingClients.id, financialRecords.billingClientId))
    .where(and(...baseFilters(range, filter), eq(financialRecords.direction, 'out')))
    .groupBy(clientKey)
    .orderBy(sql`SUM(${displayAmount}) DESC`)
    .limit(limit)
}

/** Revenue issued per platform; records with no platform are one row with a null id. */
export async function getRevenueByPlatform(range: PeriodRange, filter?: RecordFilter) {
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)
  return db
    .select({
      id: financialRecords.platformId,
      name: sql<string | null>`MAX(${platforms.name})`,
      total: sql<number>`SUM(${displayAmount})::float`,
    })
    .from(financialRecords)
    .leftJoin(platforms, eq(platforms.id, financialRecords.platformId))
    .where(and(...baseFilters(range, filter), eq(financialRecords.direction, 'out')))
    .groupBy(financialRecords.platformId)
    .orderBy(sql`SUM(${displayAmount}) DESC`)
}

/**
 * Collected revenue (issued, paid) per day, week or month, the buckets cut in the company's time
 * zone so "today" is the company's today. Dates come back as YYYY-MM-DD (the bucket's first day).
 */
export async function getPaidRevenueBuckets(
  range: PeriodRange,
  granularity: 'day' | 'week' | 'month',
  timeZone: string,
  filter?: RecordFilter,
) {
  const bucket = sql<string>`TO_CHAR(DATE_TRUNC(${granularity}, ${financialRecords.issuedAt} AT TIME ZONE ${timeZone}), 'YYYY-MM-DD')`
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)
  return db
    .select({ date: bucket, value: sql<number>`SUM(${displayAmount})::float` })
    .from(financialRecords)
    .where(and(...baseFilters(range, filter), eq(financialRecords.direction, 'out'), eq(financialRecords.paymentStatus, 'paid')))
    // By position: the bucket expression has bound parameters, so Postgres would not match a repeated copy.
    .groupBy(sql`1`)
    .orderBy(sql`1`)
}

export async function getPaidRevenueTotal(range: PeriodRange, filter?: RecordFilter): Promise<number> {
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${displayAmount}), 0)::float` })
    .from(financialRecords)
    .where(and(...baseFilters(range, filter), eq(financialRecords.direction, 'out'), eq(financialRecords.paymentStatus, 'paid')))
  return row?.total ?? 0
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
