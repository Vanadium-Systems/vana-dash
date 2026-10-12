import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { alerts, financialRecords, platformMetrics, syncLog } from '../../shared/db/schema/index.js'
import { getCurrentMrr, getPnlTotals } from '../../shared/lib/financial-aggregation.js'
import { htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { displayMoney, fromRon } from '../../shared/lib/display-money.js'
import { displayAmountSql } from '../../shared/lib/sql-fx.js'
import type {
  ExpenseBreakdownTrendQuerySchema,
  MonthlySnapshotQuerySchema,
  MrrTrendQuerySchema,
  PeriodComparisonQuerySchema,
} from './schema.js'
import type { z } from 'zod'
import { tr } from '../../shared/lib/i18n.js'
import { currentLocale } from '../../shared/lib/request-context.js'

const CLIENT_TREND_METRIC_KEYS = ['active_clients', 'vanagreen.demo_clients'] as const

/**
 * `active_clients`/`vanagreen.demo_clients` sunt gauge-uri (valoare curentă la momentul
 * sync-ului, nu flow) — trendul lunar ia ULTIMA valoare înregistrată din lună
 * (ARRAY_AGG...ORDER BY DESC, la fel ca `getSummary` din modules/metrics/service.ts), nu SUM.
 *
 * MRR nu are istoric lunar stocat (vezi nota din shared/lib/financial-aggregation.ts —
 * `mrr` a dispărut din platform_metrics odată cu Sprint C) — expunem valoarea curentă
 * (`getCurrentMrr`) separat de trendul real de clienți, nu inventăm un istoric fals.
 */
export async function getMrrTrend(query: z.infer<typeof MrrTrendQuerySchema>) {
  const month = sql<string>`TO_CHAR(DATE_TRUNC('month', ${platformMetrics.recordedAt}) AT TIME ZONE 'UTC', 'YYYY-MM')`

  const clientsByMonth = await db
    .select({
      month,
      metricKey: platformMetrics.metricKey,
      value: sql<number>`(ARRAY_AGG(${platformMetrics.value}::float ORDER BY ${platformMetrics.recordedAt} DESC))[1]`,
    })
    .from(platformMetrics)
    .where(
      and(
        isNull(platformMetrics.deletedAt),
        inArray(platformMetrics.metricKey, [...CLIENT_TREND_METRIC_KEYS]),
        gte(platformMetrics.recordedAt, query.from),
        lte(platformMetrics.recordedAt, query.to),
      ),
    )
    .groupBy(month, platformMetrics.metricKey)
    .orderBy(month)

  const [mrr, money] = await Promise.all([getCurrentMrr(), displayMoney()])
  return { clientsByMonth, currentMrr: { ...mrr, mrrDisplay: fromRon(mrr.mrrLei, money) } }
}

export async function getPeriodComparison(query: z.infer<typeof PeriodComparisonQuerySchema>) {
  const [periodA, periodB] = await Promise.all([
    getPnlTotals({ from: query.fromA, to: query.toA }),
    getPnlTotals({ from: query.fromB, to: query.toB }),
  ])
  return { periodA, periodB }
}

/** The column names carry the currency the figures are in (`venit_ron`, `venit_eur`). */
export function periodComparisonToCsv(comparison: Awaited<ReturnType<typeof getPeriodComparison>>, currency: string = 'RON'): string {
  const unit = currency.toLowerCase()
  const header = ['perioada', `venit_${unit}`, `cheltuiala_${unit}`, `net_${unit}`]
  const rows = [
    ['A', comparison.periodA.revenue, comparison.periodA.expense, comparison.periodA.net],
    ['B', comparison.periodB.revenue, comparison.periodB.expense, comparison.periodB.net],
  ].map((row) => row.join(','))
  return [header.join(','), ...rows].join('\n')
}

/** Total cheltuieli pe categorie x lună (stacked) — GROUP BY în SQL (regula #9). */
export async function getExpenseBreakdownTrend(query: z.infer<typeof ExpenseBreakdownTrendQuerySchema>) {
  const month = sql<string>`TO_CHAR(DATE_TRUNC('month', ${financialRecords.issuedAt}) AT TIME ZONE 'UTC', 'YYYY-MM')`
  const category = sql<string>`COALESCE(${financialRecords.category}, 'necategorizat')`
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)

  return db
    .select({
      month,
      category,
      total: sql<number>`SUM(${displayAmount})::float`,
    })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'in'),
        gte(financialRecords.issuedAt, query.from),
        lte(financialRecords.issuedAt, query.to),
      ),
    )
    .groupBy(month, category)
    .orderBy(month)
}

function monthRange(month: string): { from: Date; to: Date } {
  const parts = month.split('-').map(Number)
  const year = parts[0] ?? 0
  const monthNum = parts[1] ?? 1
  const from = new Date(Date.UTC(year, monthNum - 1, 1))
  const to = new Date(Date.UTC(year, monthNum, 1))
  return { from, to }
}

/**
 * Un singur payload cross-modul pt. "raportul lunar" (roadmap #8) — compune Financials,
 * Alerts și sync_log, fără să dubleze agregările (getPnlTotals/getCurrentMrr din
 * shared/lib/financial-aggregation.ts, aceleași folosite de period-comparison).
 */
export async function getMonthlySnapshot(query: z.infer<typeof MonthlySnapshotQuerySchema>) {
  const { from, to } = monthRange(query.month)
  const range = { from, to }

  const [money, totals, mrr, topExpenseCategories, alertCount, syncStats] = await Promise.all([
    displayMoney(),
    getPnlTotals(range),
    getCurrentMrr(),
    getTopExpenseCategories(range),
    countAlertsTriggered(range),
    getSyncSuccessRate(range),
  ])

  return {
    month: query.month,
    currency: money.currency,
    revenue: totals.revenue,
    expense: totals.expense,
    net: totals.net,
    mrr: { ...mrr, mrrDisplay: fromRon(mrr.mrrLei, money) },
    topExpenseCategories,
    alertsTriggered: alertCount,
    syncSuccessRate: syncStats,
  }
}

async function getTopExpenseCategories(range: { from: Date; to: Date }) {
  const category = sql<string>`COALESCE(${financialRecords.category}, 'necategorizat')`
  const displayAmount = displayAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt, (await displayMoney()).currency)

  return db
    .select({ category, total: sql<number>`SUM(${displayAmount})::float` })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'in'),
        gte(financialRecords.issuedAt, range.from),
        lte(financialRecords.issuedAt, range.to),
      ),
    )
    .groupBy(category)
    .orderBy(sql`SUM(${displayAmount}) DESC`)
    .limit(5)
}

async function countAlertsTriggered(range: { from: Date; to: Date }): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(alerts)
    .where(and(gte(alerts.triggeredAt, range.from), lte(alerts.triggeredAt, range.to)))
  return row?.count ?? 0
}

async function getSyncSuccessRate(range: { from: Date; to: Date }): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      success: sql<number>`COUNT(*) FILTER (WHERE ${syncLog.status} = 'SUCCESS')::int`,
    })
    .from(syncLog)
    .where(and(gte(syncLog.startedAt, range.from), lte(syncLog.startedAt, range.to)))

  const total = row?.total ?? 0
  const success = row?.success ?? 0
  return total > 0 ? Math.round((success / total) * 1000) / 10 : 100
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`
}

function renderMonthlySnapshotHtml(snapshot: Awaited<ReturnType<typeof getMonthlySnapshot>>): string {
  const categoryRows = snapshot.topExpenseCategories
    .map((c) => `<tr><td>${c.category}</td><td class="num">${money(c.total, snapshot.currency)}</td></tr>`)
    .join('')

  return `<!doctype html>
<html lang="${currentLocale()}">
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 12px; margin: 0; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 24px; }
  .kpis { display: flex; gap: 16px; margin-bottom: 24px; }
  .kpi { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .kpi .label { font-size: 10px; text-transform: uppercase; color: #666; }
  .kpi .value { font-size: 18px; font-weight: bold; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; border-bottom: 2px solid #1a1a1a; padding: 6px 8px; font-size: 11px; text-transform: uppercase; }
  td { border-bottom: 1px solid #eee; padding: 6px 8px; }
  .num { text-align: right; }
</style>
</head>
<body>
  <h1>${tr('emails.monthlyReport.pdf.title', { month: snapshot.month })}</h1>
  <div class="kpis">
    <div class="kpi"><div class="label">${tr('emails.monthlyReport.pdf.revenue')}</div><div class="value">${money(snapshot.revenue, snapshot.currency)}</div></div>
    <div class="kpi"><div class="label">${tr('emails.monthlyReport.pdf.expenses')}</div><div class="value">${money(snapshot.expense, snapshot.currency)}</div></div>
    <div class="kpi"><div class="label">${tr('emails.monthlyReport.pdf.net')}</div><div class="value">${money(snapshot.net, snapshot.currency)}</div></div>
    <div class="kpi"><div class="label">${tr('emails.monthlyReport.pdf.mrr')}</div><div class="value">${money(snapshot.mrr.mrrDisplay, snapshot.currency)}</div></div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="label">${tr('emails.monthlyReport.pdf.alerts')}</div><div class="value">${snapshot.alertsTriggered}</div></div>
    <div class="kpi"><div class="label">${tr('emails.monthlyReport.pdf.syncRate')}</div><div class="value">${snapshot.syncSuccessRate}%</div></div>
  </div>
  <table>
    <thead><tr><th>${tr('emails.monthlyReport.pdf.topCategories')}</th><th class="num">${tr('emails.monthlyReport.pdf.total')}</th></tr></thead>
    <tbody>${categoryRows || `<tr><td colspan="2">${tr('emails.monthlyReport.pdf.noExpenses')}</td></tr>`}</tbody>
  </table>
</body>
</html>`
}

/** PDF streamed direct (nimic persistat — raport la cerere, nu arhivat). Null dacă Chromium indisponibil. */
export async function generateMonthlySnapshotPdf(query: z.infer<typeof MonthlySnapshotQuerySchema>): Promise<Buffer | null> {
  if (!isPdfAvailable()) return null
  const snapshot = await getMonthlySnapshot(query)
  return htmlToPdf(renderMonthlySnapshotHtml(snapshot))
}
