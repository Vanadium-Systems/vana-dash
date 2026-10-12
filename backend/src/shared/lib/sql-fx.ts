import { sql, type Column, type SQL } from 'drizzle-orm'
import { exchangeRates } from '../db/schema/index.js'
import type { DisplayCurrency } from './locale.js'

/**
 * Convertește o coloană `amount` la RON, pt. agregare SQL (regula #9 CLAUDE.md — nu `.reduce()`
 * în JS). Subquery corelat PER RÂND — ia cursul BNR cel mai apropiat ≤ data rândului (`issuedAt`),
 * nu un curs fix pt. tot query-ul, la fel cum se calculează și la facturare (`getRateForDate`).
 * RON trece neschimbat, fără subquery. Fără curs găsit (ex: valută dinainte să existe istoric
 * BNR) → degradează la 1:1 (nu aruncă — regula #7 CLAUDE.md, agregarea nu trebuie să crape),
 * la fel cum `getRecurringRevenue` degradează azi când BNR e jos.
 */
export function ronAmountSql(amount: Column | SQL, currency: Column | SQL, issuedAt: Column | SQL): SQL<number> {
  return sql<number>`(CASE WHEN ${currency} = 'RON' THEN ${amount}::numeric ELSE ${amount}::numeric * COALESCE((
    SELECT ${exchangeRates.rate}::numeric FROM ${exchangeRates}
    WHERE ${exchangeRates.currency} = ${currency}
      AND ${exchangeRates.deletedAt} IS NULL
      AND ${exchangeRates.date} <= TO_CHAR((${issuedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    ORDER BY ${exchangeRates.date} DESC
    LIMIT 1
  ), 1) END)`
}

/**
 * `amount` in the currency a person wants totals shown in, for SQL aggregation. Each row is
 * converted at the BNR rate of its own day, so a total for last year does not move when the leu
 * moves today. With RON as the target this is exactly `ronAmountSql`.
 *
 * A row already in the target currency keeps its amount. Anything else goes through RON and is
 * divided by the target's rate at or before the row's day; a row older than the first stored
 * rate uses that first rate. The caller makes sure a rate exists at all (`displayMoney`).
 * `target` reaches the query as a bound parameter, from a fixed list, never as text.
 */
export function displayAmountSql(
  amount: Column | SQL,
  currency: Column | SQL,
  issuedAt: Column | SQL,
  target: DisplayCurrency,
): SQL<number> {
  const ron = ronAmountSql(amount, currency, issuedAt)
  if (target === 'RON') return ron
  const day = sql`TO_CHAR((${issuedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
  return sql<number>`(CASE WHEN ${currency} = ${target} THEN ${amount}::numeric ELSE ${ron} / COALESCE((
    SELECT ${exchangeRates.rate}::numeric FROM ${exchangeRates}
    WHERE ${exchangeRates.currency} = ${target}
      AND ${exchangeRates.deletedAt} IS NULL
      AND ${exchangeRates.date} <= ${day}
    ORDER BY ${exchangeRates.date} DESC
    LIMIT 1
  ), (
    SELECT ${exchangeRates.rate}::numeric FROM ${exchangeRates}
    WHERE ${exchangeRates.currency} = ${target}
      AND ${exchangeRates.deletedAt} IS NULL
    ORDER BY ${exchangeRates.date} ASC
    LIMIT 1
  )) END)`
}
