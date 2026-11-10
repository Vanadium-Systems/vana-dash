import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { prospectContactPoints } from '../db/schema/index.js'

/**
 * Marks every live email contact point holding exactly this address. Exact match on the
 * normalized value, no LIKE. Returns the prospects touched, so the caller can react to them.
 *
 * An unsubscribe is final, so a later bounce on the same address leaves an `unsubscribed`
 * point alone (the reverse overwrites: the person asked to stop, the mailbox state is moot).
 */
export async function markContactAddress(address: string, status: 'unsubscribed' | 'bounced'): Promise<string[]> {
  const rows = await db
    .update(prospectContactPoints)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(prospectContactPoints.kind, 'email'),
        sql`${prospectContactPoints.valueNormalized} = lower(trim(${address}))`,
        isNull(prospectContactPoints.deletedAt),
        status === 'bounced' ? ne(prospectContactPoints.status, 'unsubscribed') : undefined,
      ),
    )
    .returning({ prospectId: prospectContactPoints.prospectId })
  return [...new Set(rows.map((r) => r.prospectId))]
}

/** Prospects with a live email contact point on exactly this address. */
export async function findProspectIdsByAddress(address: string): Promise<string[]> {
  const rows = await db
    .select({ prospectId: prospectContactPoints.prospectId })
    .from(prospectContactPoints)
    .where(and(eq(prospectContactPoints.kind, 'email'), sql`${prospectContactPoints.valueNormalized} = lower(trim(${address}))`, isNull(prospectContactPoints.deletedAt)))
  return [...new Set(rows.map((r) => r.prospectId))]
}
