import { boolean, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { platforms } from './platforms.js'
import { tenantColumns } from './tenant-column.js'

export const alertRules = pgTable('alert_rules', {
  ...tenantColumns,
  ...standardColumns,
  ...auditColumns,
  name: text('name').notNull(),
  metricKey: text('metric_key').notNull(),
  condition: text('condition', { enum: ['lt', 'lte', 'gt', 'gte'] }).notNull(),
  threshold: numeric('threshold', { precision: 18, scale: 4 }).notNull(),
  windowHours: integer('window_hours').notNull().default(24),
  severity: text('severity', { enum: ['info', 'warning', 'critical'] }).notNull().default('warning'),
  enabled: boolean('enabled').notNull().default(true),
  // null = regula se aplică tuturor platformelor
  platformId: uuid('platform_id').references(() => platforms.id, { onDelete: 'cascade' }),
})
