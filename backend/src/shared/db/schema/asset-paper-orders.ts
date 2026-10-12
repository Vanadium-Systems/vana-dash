import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { assetBrokers } from './asset-brokers.js'

// Ordine simulate în paper mode (PLAN.md Track D — Wave 7) — Trading212 nu are testnet prin
// API, deci paper e ÎNTOTDEAUNA local: market se execută imediat la prețul live (Finnhub/
// Twelve Data), limit rămâne open până ce sync-ul o trece prin preț. Pattern identic
// crypto_paper_orders — P&L-ul portofoliului se calculează la preț live din istoric, nu se stochează.
export const assetPaperOrders = pgTable('asset_paper_orders', {
  ...standardColumns,
  brokerId: uuid('broker_id')
    .notNull()
    .references(() => assetBrokers.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  side: text('side', { enum: ['buy', 'sell'] }).notNull(),
  orderType: text('order_type', { enum: ['market', 'limit'] }).notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  limitPrice: numeric('limit_price', { precision: 18, scale: 4 }),
  executedPrice: numeric('executed_price', { precision: 18, scale: 4 }),
  status: text('status', { enum: ['open', 'filled', 'cancelled'] }).notNull().default('open'),
  executedAt: timestamp('executed_at', { withTimezone: true }),
})
