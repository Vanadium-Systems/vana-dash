import { numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Curs BNR zilnic (EUR/RON) — folosit la facturarea clienților `billing_clients` cu
// `subscriptionPriceCurrency='eur'` (Sprint C, Track B). Un rând per (date, currency).
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    ...standardColumns,
    date: text('date').notNull(),
    currency: text('currency').notNull(),
    rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_exchange_rates_date_currency').on(t.date, t.currency)],
)
