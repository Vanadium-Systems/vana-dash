import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { alertRules } from './alert-rules.js'

export const alerts = pgTable(
  'alerts',
  {
    ...standardColumns,
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => alertRules.id, { onDelete: 'cascade' }),
    severity: text('severity', { enum: ['info', 'warning', 'critical'] }).notNull(),
    message: text('message').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  },
  (t) => [index('ix_alerts_triggered').on(t.triggeredAt)],
)
