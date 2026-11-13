import { sql } from 'drizzle-orm'
import { type AnyPgColumn, boolean, jsonb, date, index, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns, users } from './users.js'
import { platforms } from './platforms.js'
import { billingClients } from './billing-clients.js'
import { tenantColumns } from './tenant-column.js'

// Prospects (CRM): local data only, no connector, like `notes` and `wishlist_items`. The
// status is plain text, not a DB enum, so the vocabulary can grow without a migration (same
// choice as `email_messages.inboundSource`).
export const prospects = pgTable(
  'prospects',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    name: text('name').notNull(),
    cif: text('cif'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    contactName: text('contact_name'),
    caenCode: text('caen_code'),
    foundingYear: integer('founding_year'),
    employeeCount: integer('employee_count'),
    revenue: numeric('revenue', { precision: 14, scale: 2 }),
    profit: numeric('profit', { precision: 14, scale: 2 }),
    debt: numeric('debt', { precision: 14, scale: 2 }),
    equity: numeric('equity', { precision: 14, scale: 2 }),
    cash: numeric('cash', { precision: 14, scale: 2 }),
    receivables: numeric('receivables', { precision: 14, scale: 2 }),
    inventory: numeric('inventory', { precision: 14, scale: 2 }),
    score: numeric('score', { precision: 5, scale: 1 }),
    status: text('status').notNull().default('necontactat'),
    contactedBy: text('contacted_by'),
    source: text('source'),
    platformId: uuid('platform_id').references(() => platforms.id),
    billingClientId: uuid('billing_client_id').references(() => billingClients.id),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    // The colleague working this prospect, so two salespeople do not call the same company.
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    lostReason: text('lost_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    valueAmount: numeric('value_amount', { precision: 14, scale: 2 }),
    valueCurrency: text('value_currency'),
    // The calculator quote for this prospect; applied on the client when the prospect is promoted.
    offer: jsonb('offer'),
    expectedCloseAt: date('expected_close_at'),
    // Since when the current owner holds it; the automatic release counts idle days from here.
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Any activity: note, task done, call, email sent.
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    // false = struck off the register; the score reads it on every recalculation.
    isActive: boolean('is_active'),
    cifNormalized: text('cif_normalized').generatedAlwaysAs(sql`upper(regexp_replace(coalesce(cif, ''), '^[[:space:]]*RO|[[:space:]]', '', 'gi'))`),
    // Previous year's revenue and the year of `revenue`, for the growth signal.
    revenuePrev: numeric('revenue_prev', { precision: 14, scale: 2 }),
    revenueYear: smallint('revenue_year'),
    // Financial score before criteria; `score` is the final, normalized one.
    scoreBase: numeric('score_base', { precision: 5, scale: 1 }),
    // Set when merged into another prospect; old links follow it.
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => prospects.id),
  },
  (t) => [
    index('idx_prospects_score').on(t.score.desc()),
    index('idx_prospects_status').on(t.status),
    index('idx_prospects_assigned_user').on(t.assignedUserId),
    uniqueIndex('idx_prospects_cif').on(t.tenantId, t.cif).where(sql`${t.cif} IS NOT NULL`),
    index('idx_prospects_cif_normalized').on(t.tenantId, t.cifNormalized),
    index('idx_prospects_owner_activity').on(t.tenantId, t.assignedUserId, t.lastActivityAt),
  ],
)

// Archiving is per person: everyone shares the same prospects, but hiding one from my list must
// not hide it from a colleague's. A row here means "this user archived this prospect".
export const prospectArchives = pgTable(
  'prospect_archives',
  {
    ...tenantColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.prospectId, t.userId] }),
    index('idx_prospect_archives_user').on(t.tenantId, t.userId),
  ],
)

// Un singur rând (pattern `dashboard_config` pt. `vanagreen_auto_extend_enabled`) — ponderile +
// pragurile scoring-ului, editabile din UI. Curbele din sub-scoruri rămân constante fixe în
// scoring.ts (decizie de scop, vezi PLAN.md).
export const prospectScoringConfig = pgTable('prospect_scoring_config', {
  ...tenantColumns,
  ...standardColumns,
  budgetWeight: numeric('budget_weight', { precision: 4, scale: 3 }).notNull().default('0.25'),
  needWeight: numeric('need_weight', { precision: 4, scale: 3 }).notNull().default('0.30'),
  techWeight: numeric('tech_weight', { precision: 4, scale: 3 }).notNull().default('0.25'),
  contactWeight: numeric('contact_weight', { precision: 4, scale: 3 }).notNull().default('0.20'),
  hotThreshold: numeric('hot_threshold', { precision: 5, scale: 1 }).notNull().default('65'),
  warmThreshold: numeric('warm_threshold', { precision: 5, scale: 1 }).notNull().default('50'),
  nurtureThreshold: numeric('nurture_threshold', { precision: 5, scale: 1 }).notNull().default('35'),
  baseWeight: numeric('base_weight', { precision: 3, scale: 2 }).notNull().default('1'),
  criteria: jsonb('criteria').notNull().default([]),
  labels: jsonb('labels'),
})
