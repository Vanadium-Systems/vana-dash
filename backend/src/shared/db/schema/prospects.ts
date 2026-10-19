import { sql } from 'drizzle-orm'
import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns, users } from './users.js'
import { platforms } from './platforms.js'
import { billingClients } from './billing-clients.js'

// Prospects (CRM): local data only, no connector, like `notes` and `wishlist_items`. The
// status is plain text, not a DB enum, so the vocabulary can grow without a migration (same
// choice as `email_messages.inboundSource`).
export const prospects = pgTable(
  'prospects',
  {
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
    notes: text('notes'),
    source: text('source'),
    platformId: uuid('platform_id').references(() => platforms.id),
    billingClientId: uuid('billing_client_id').references(() => billingClients.id),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    // Arhivare — distinctă de `deletedAt` (soft delete "definitiv"): un prospect arhivat dispare
    // din lista implicită, dar rămâne căutabil explicit (filtru "Arhivate"), nu e o ștergere.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // The colleague working this prospect, so two salespeople do not call the same company.
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
  },
  (t) => [
    index('idx_prospects_score').on(t.score.desc()),
    index('idx_prospects_status').on(t.status),
    index('idx_prospects_assigned_user').on(t.assignedUserId),
    uniqueIndex('idx_prospects_cif').on(t.cif).where(sql`${t.cif} IS NOT NULL`),
  ],
)

// Un singur rând (pattern `dashboard_config` pt. `vanagreen_auto_extend_enabled`) — ponderile +
// pragurile scoring-ului, editabile din UI. Curbele din sub-scoruri rămân constante fixe în
// scoring.ts (decizie de scop, vezi PLAN.md).
export const prospectScoringConfig = pgTable('prospect_scoring_config', {
  ...standardColumns,
  budgetWeight: numeric('budget_weight', { precision: 4, scale: 3 }).notNull().default('0.25'),
  needWeight: numeric('need_weight', { precision: 4, scale: 3 }).notNull().default('0.30'),
  techWeight: numeric('tech_weight', { precision: 4, scale: 3 }).notNull().default('0.25'),
  contactWeight: numeric('contact_weight', { precision: 4, scale: 3 }).notNull().default('0.20'),
  hotThreshold: numeric('hot_threshold', { precision: 5, scale: 1 }).notNull().default('65'),
  warmThreshold: numeric('warm_threshold', { precision: 5, scale: 1 }).notNull().default('50'),
  nurtureThreshold: numeric('nurture_threshold', { precision: 5, scale: 1 }).notNull().default('35'),
})
