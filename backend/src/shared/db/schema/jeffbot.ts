import { sql } from 'drizzle-orm'
import { check, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// jeffbot: an external paper trading bot. It pushes a snapshot every 5 minutes to
// POST /api/v1/integrations/jeffbot/snapshot. Everything is idempotent (upsert on the unique
// keys below), so a snapshot sent twice duplicates nothing.

// Ultimul snapshot primit (un singur rând, key = 'current'), fără seriile care se acumulează.
export const jeffbotState = pgTable(
  'jeffbot_state',
  {
    ...tenantColumns,
    ...standardColumns,
    key: text('key').notNull().default('current'),
    payload: jsonb('payload').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ keyUniq: uniqueIndex('jeffbot_state_key_uniq').on(t.key) }),
)

// Piața din care vine seria: cheile de strategie se repetă între crypto și bursă (hold, trend200).
const MARKETS = ['crypto', 'stocks'] as const

// Echitatea orară per strategie (key = hold | trend200 | trend50 | rotation | mix | lgbm).
export const jeffbotEquityPoints = pgTable(
  'jeffbot_equity_points',
  {
    ...tenantColumns,
    ...standardColumns,
    market: text('market', { enum: MARKETS }).notNull().default('crypto'),
    key: text('key').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    equity: numeric('equity', { precision: 14, scale: 4 }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('jeffbot_equity_points_uniq').on(t.market, t.key, t.ts),
    marketCheck: check('jeffbot_equity_points_market_check', sql`${t.market} IN ('crypto', 'stocks')`),
  }),
)

export const jeffbotTrades = pgTable(
  'jeffbot_trades',
  {
    ...tenantColumns,
    ...standardColumns,
    market: text('market', { enum: MARKETS }).notNull().default('crypto'),
    sourceId: text('source_id').notNull(), // id-ul din SQLite-ul botului ("strat:17", "lgbm:3")
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    strategy: text('strategy').notNull(),
    subAccount: text('sub_account'),
    symbol: text('symbol').notNull(),
    side: text('side', { enum: ['buy', 'sell', 'long', 'short', 'flat'] }).notNull(),
    qty: numeric('qty', { precision: 24, scale: 8 }).notNull(),
    price: numeric('price', { precision: 18, scale: 8 }).notNull(),
    feeUsdt: numeric('fee_usdt', { precision: 14, scale: 4 }).notNull(),
    reason: text('reason'),
  },
  (t) => ({
    sourceUniq: uniqueIndex('jeffbot_trades_source_uniq').on(t.sourceId),
    marketTsIdx: index('jeffbot_trades_market_ts_idx').on(t.market, t.ts),
    marketCheck: check('jeffbot_trades_market_check', sql`${t.market} IN ('crypto', 'stocks')`),
  }),
)

// Rapoartele Claude-ului automat de pe server (zilnic Sonnet, săptămânal Opus).
export const jeffbotReviews = pgTable(
  'jeffbot_reviews',
  {
    ...tenantColumns,
    ...standardColumns,
    date: date('date').notNull(),
    kind: text('kind', { enum: ['daily', 'weekly'] }).notNull(),
    severity: text('severity', { enum: ['ok', 'warn', 'critical'] }).notNull(),
    summary: text('summary').notNull(),
    markdown: text('markdown').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('jeffbot_reviews_date_kind_uniq').on(t.date, t.kind) }),
)
