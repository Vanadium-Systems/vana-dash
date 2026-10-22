import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { tenants } from '../db/schema/index.js'
import { runAsTenant, withRlsBypass } from './tenancy.js'

/** Every active company, one after the other (never in parallel: the outside services we call
 *  have strict rate limits). */
export async function forEachTenant(fn: (tenantId: string) => Promise<void>): Promise<void> {
  // The list of companies is the platform's, not a company's.
  const rows = await withRlsBypass(() =>
    db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.status, 'active'), isNull(tenants.deletedAt)))
      .orderBy(asc(tenants.createdAt)),
  )
  for (const row of rows) await runAsTenant(row.id, () => fn(row.id))
}

/** An active company by id, or null. Read across companies: the caller is the platform admin. */
export async function findActiveTenant(id: string): Promise<{ id: string } | null> {
  const [row] = await withRlsBypass(() =>
    db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, id), eq(tenants.status, 'active'), isNull(tenants.deletedAt))),
  )
  return row ?? null
}
