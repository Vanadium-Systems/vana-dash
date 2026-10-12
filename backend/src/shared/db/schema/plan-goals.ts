import { date, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'

export const planGoals = pgTable(
  'plan_goals',
  {
    ...standardColumns,
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['personal', 'firma'] }).notNull(),
    tier: integer('tier').notNull().default(1),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    note: text('note'),
    thresholdType: text('threshold_type', { enum: ['manual', 'mrr_ron'] }).notNull().default('manual'),
    thresholdValue: numeric('threshold_value', { precision: 14, scale: 2 }),
    monthlyCostRon: numeric('monthly_cost_ron', { precision: 10, scale: 2 }),
    targetPriceAmount: numeric('target_price_amount', { precision: 12, scale: 2 }),
    targetPriceCurrency: text('target_price_currency', { enum: ['RON', 'EUR'] }),
    targetDate: date('target_date', { mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('ix_plan_goals_scope_tier_position').on(t.scope, t.tier, t.position)],
)
