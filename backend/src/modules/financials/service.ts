import { and, asc, eq, isNull, gte, lte, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { exchangeRates, recurringExpenses } from '../../shared/db/schema/index.js'
import { getRateForDate } from '../../shared/lib/bnr.js'
import {
  getCashflowByStatus,
  getCurrentMrr,
  getDailyPaidRevenue,
  getPnlByCategory,
  getPnlByMonth,
} from '../../shared/lib/financial-aggregation.js'
import type { PeriodRange } from '../../shared/lib/period.js'
import type { ExchangeRateQuerySchema } from './schema.js'
import type { z } from 'zod'

// P&L / cashflow strict pe financial_records — NU pe platform_metrics, ca să nu
// dublăm venitul (decizie confirmată în plan). Toată agregarea în SQL (regula #9).
// Query-urile propriu-zise trăiesc în shared/lib/financial-aggregation.ts (reutilizate
// și de modules/reports/service.ts) — funcțiile de mai jos doar le compun.

/**
 * P&L: revenue vs. expense pe lună (din direction: out=venit emis, in=cheltuială/factură
 * primită) + breakdown pe categorie.
 *
 * `paymentStatus` e inclus în grupare (nu doar în `getCashflow`) ca frontend-ul să poată
 * despărți "Venituri" (încasate) de sumele facturate dar neîncasate încă — o factură emisă
 * dar neplătită nu e venit realizat, e doar promisiune de venit ("în așteptare").
 */
export async function getPnl(range: PeriodRange) {
  const [byMonth, byCategory] = await Promise.all([getPnlByMonth(range), getPnlByCategory(range)])
  return { byMonth, byCategory }
}

/**
 * Recurring revenue (MRR) — Sprint C, Track B: calculat acum DIN vana-dash
 * (billing_clients), nu mai vine din vanagreen (sursa veche, tenant_payments/
 * subscription_price_*, a fost ștearsă acolo). SUM pe currency în SQL (regula #9
 * CLAUDE.md — agregare în query, nu în JS); clienții cu preț în EUR sunt convertiți
 * la cursul BNR de azi (aceeași sursă folosită la emiterea facturilor,
 * jobs/vanagreen-billing.ts) — conversia în sine e o singură înmulțire în JS,
 * inevitabil (rata vine dintr-un fetch extern async, nu dintr-o coloană SQL).
 */
export async function getRecurringRevenue() {
  return getCurrentMrr()
}

/**
 * Serie zilnică de venit real, pt. graficul de Venituri din Overview — vezi
 * getDailyPaidRevenue (financial-aggregation.ts) pt. de ce nu mai vine din platform_metrics.
 */
export async function getRevenueSeries(range: PeriodRange) {
  return getDailyPaidRevenue(range)
}

/**
 * Cheltuieli recurente active, normalizate la echivalent lunar (anual/12), convertite la RON —
 * calculat LIVE din `recurring_expenses`, NU din `financial_records`. O cheltuială recurentă abia
 * creată nu are încă niciun rând materializat (jobs/recurring-expenses.ts scrie unul doar la
 * `nextDueDate`) — fără acest KPI ar fi invizibilă până la următoarea rulare de cron, exact gap-ul
 * semnalat de Stefan. Aceeași idee ca `getRecurringRevenue` de mai sus (MRR calculat live din
 * billing_clients, nu din facturi emise).
 */
export async function getRecurringExpensesMonthly() {
  const rows = await db
    .select({
      currency: recurringExpenses.currency,
      // Anual → echivalent lunar (/12); lunar rămâne neschimbat. SUM în SQL, nu în JS (regula #9).
      total: sql<string>`COALESCE(SUM(CASE
        WHEN ${recurringExpenses.cycle} = 'annual' THEN ${recurringExpenses.amount}::numeric / 12
        ELSE ${recurringExpenses.amount}::numeric
      END), 0)`,
    })
    .from(recurringExpenses)
    .where(and(isNull(recurringExpenses.deletedAt), eq(recurringExpenses.active, true)))
    .groupBy(recurringExpenses.currency)

  let monthlyRon = 0
  const todayIso = new Date().toISOString().slice(0, 10)
  for (const row of rows) {
    const amount = Number(row.total)
    if (amount <= 0) continue
    if (row.currency === 'RON') {
      monthlyRon += amount
      continue
    }
    try {
      const rateRow = await getRateForDate(todayIso, row.currency)
      monthlyRon += amount * Number(rateRow.rate)
    } catch {
      // BNR jos — KPI-ul afișează tot ce poate convertit, doar fără moneda asta de data asta;
      // nu blocăm dashboard-ul pt. atât (la fel ca getRecurringRevenue).
    }
  }

  return { monthlyRon: Math.round(monthlyRon * 100) / 100 }
}

/**
 * Sprint D, Track 2 — istoric curs BNR pt. graficul din Financials (zi/lună/an).
 * `daily` întoarce rândurile brute din `exchange_rates`; `monthly`/`yearly` agregă cu
 * AVG în SQL (regula #9 CLAUDE.md — nu `.reduce()` în JS).
 */
export async function getExchangeRateHistory(query: z.infer<typeof ExchangeRateQuerySchema>) {
  const filters = [eq(exchangeRates.currency, query.currency)]
  if (query.from) filters.push(gte(exchangeRates.date, query.from))
  if (query.to) filters.push(lte(exchangeRates.date, query.to))

  if (query.period === 'daily') {
    return db
      .select({ date: exchangeRates.date, rate: sql<string>`${exchangeRates.rate}::text` })
      .from(exchangeRates)
      .where(and(...filters))
      .orderBy(asc(exchangeRates.date))
  }

  const truncUnit = query.period === 'monthly' ? 'month' : 'year'
  const bucket = sql<string>`TO_CHAR(DATE_TRUNC('${sql.raw(truncUnit)}', ${exchangeRates.date}::date), 'YYYY-MM-DD')`

  return db
    .select({ date: bucket, rate: sql<string>`ROUND(AVG(${exchangeRates.rate}::numeric), 6)::text` })
    .from(exchangeRates)
    .where(and(...filters))
    .groupBy(bucket)
    .orderBy(bucket)
}

/**
 * Cashflow: paid vs. unpaid/partial, grupat pe direcție — câte înregistrări și cât valorează.
 * `total` convertit la RON per rând, la fel ca `getPnl`.
 */
export async function getCashflow(range: PeriodRange) {
  return getCashflowByStatus(range)
}
