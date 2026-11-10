import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { prospects } from './prospects.js'
import { tenantColumns } from './tenant-column.js'

// One row per fixed rule (modules/prospects/automations.ts). A new rule is code, not configuration.
export const prospectAutomationRules = pgTable(
  'prospect_automation_rules',
  {
    ...tenantColumns,
    ...standardColumns,
    ruleKey: text('rule_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    params: jsonb('params').notNull().default({}),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunCount: integer('last_run_count'),
  },
  (t) => [uniqueIndex('uq_automation_rule').on(t.tenantId, t.ruleKey)],
)

// A named condition on prospects (a set of list filters) with what to say on the phone when it hits.
export const prospectSignals = pgTable('prospect_signals', {
  ...tenantColumns,
  ...standardColumns,
  name: text('name').notNull(),
  groupKey: text('group_key').notNull(),
  description: text('description'),
  filters: jsonb('filters').notNull(),
  talkingTip: text('talking_tip'),
  // Set on the signals the app ships with: editable and switchable off, not deletable.
  builtinKey: text('builtin_key'),
  enabled: boolean('enabled').notNull().default(true),
})

export const prospectSignalHits = pgTable(
  'prospect_signal_hits',
  {
    ...tenantColumns,
    ...standardColumns,
    signalId: uuid('signal_id')
      .notNull()
      .references(() => prospectSignals.id, { onDelete: 'cascade' }),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_signal_hits').on(t.tenantId, t.signalId, t.prospectId),
    index('idx_signal_hits_prospect').on(t.prospectId),
  ],
)
