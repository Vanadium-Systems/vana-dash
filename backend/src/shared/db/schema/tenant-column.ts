import { sql } from 'drizzle-orm'
import { uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

// The company a row belongs to. The default reads the request's tenant (set per transaction by
// shared/db/client.ts when RLS_ENABLED) and falls back to the platform owner, so the inserts
// written before tenancy keep working and the column is filled without rewriting any table.
// NULLIF: after a transaction that set it, the setting reads '' on the same connection.
export const tenantColumns = {
  tenantId: uuid('tenant_id')
    .notNull()
    .default(sql`COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid)`)
    .references(() => tenants.id),
}
