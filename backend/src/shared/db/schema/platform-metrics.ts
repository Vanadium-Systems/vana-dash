import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { platforms } from './platforms.js'
import { tenantColumns } from './tenant-column.js'

export const platformMetrics = pgTable(
  'platform_metrics',
  {
    ...tenantColumns,
    ...standardColumns,
    platformId: uuid('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    value: numeric('value', { precision: 18, scale: 4 }).notNull(),
    unit: text('unit'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    meta: jsonb('meta'),
  },
  (t) => [
    // Target-ul pentru onConflictDoUpdate — metricile se UPSERT-ează, niciodată insert simplu.
    uniqueIndex('uq_platform_metrics_upsert').on(t.platformId, t.metricKey, t.recordedAt),
    index('ix_platform_metrics_range').on(t.platformId, t.metricKey, t.recordedAt),
  ],
)
