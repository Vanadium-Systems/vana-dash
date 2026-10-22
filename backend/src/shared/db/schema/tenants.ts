import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'

// The companies on this installation. Vanadium is the platform owner, with a fixed id
// (OWNER_TENANT_ID in shared/lib/tenancy.ts) that the migration inserts and every existing row
// is attached to.
export const tenants = pgTable(
  'tenants',
  {
    ...standardColumns,
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    cif: text('cif'),
    isPlatformOwner: boolean('is_platform_owner').notNull().default(false),
    status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
    // What the company may use (feature keys). Ignored for the owner, who has the whole catalog.
    features: text('features').array().notNull().default([]),
    // Company details for invoices and contracts; empty for the owner until they move out of env.
    profile: jsonb('profile').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [uniqueIndex('uq_tenants_slug').on(t.slug)],
)

// Every time a platform admin opens another company's data (X-Tenant-Id). Global on purpose:
// it is the platform's own log, not a company's.
export const platformAccessLog = pgTable(
  'platform_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    method: text('method').notNull(),
    path: text('path').notNull(),
    ip: text('ip'),
  },
  (t) => [index('ix_platform_access_log_tenant').on(t.tenantId, t.createdAt)],
)
