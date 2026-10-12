import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

export const dashboardConfig = pgTable(
  'dashboard_config',
  {
    ...standardColumns,
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
  },
  (t) => [uniqueIndex('uq_dashboard_config_key').on(t.key)],
)
