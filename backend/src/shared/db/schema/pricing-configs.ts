import { jsonb, pgTable, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { platforms } from './platforms.js'

// Config calculator de preț per platformă (Sprint D, Track 4) — generic, legat de platformId,
// NU hardcodat pe 'vanagreen'. Shape-ul din `config` e validat Zod strict la nivel de service
// (modules/pricing/schema.ts); DB îl stochează liber ca jsonb.
export const pricingConfigs = pgTable('pricing_configs', {
  ...standardColumns,
  platformId: uuid('platform_id')
    .notNull()
    .unique()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  config: jsonb('config').notNull(),
})
