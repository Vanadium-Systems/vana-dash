import { sql, type Column, type SQL } from 'drizzle-orm'
import { exchangeRates } from '../db/schema/index.js'

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
