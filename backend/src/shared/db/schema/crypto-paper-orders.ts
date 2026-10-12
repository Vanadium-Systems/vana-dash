import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { cryptoExchanges } from './crypto-exchanges.js'

// Ordine simulate în paper mode (PLAN.md Contract D) — market se execută imediat la prețul
// live, limit rămâne open până ce sync-ul o trece prin preț. P&L-ul portofoliului se calculează
// la preț live din istoricul acestor ordine, nu se stochează.
export const cryptoPaperOrders = pgTable('crypto_paper_orders', {
  ...standardColumns,
  exchangeId: uuid('exchange_id')
    .notNull()
    .references(() => cryptoExchanges.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  side: text('side', { enum: ['buy', 'sell'] }).notNull(),
  orderType: text('order_type', { enum: ['market', 'limit'] }).notNull(),
  quantity: numeric('quantity', { precision: 24, scale: 8 }).notNull(),
  limitPrice: numeric('limit_price', { precision: 18, scale: 4 }),
  executedPrice: numeric('executed_price', { precision: 18, scale: 4 }),
  status: text('status', { enum: ['open', 'filled', 'cancelled'] }).notNull().default('open'),
  executedAt: timestamp('executed_at', { withTimezone: true }),
})
