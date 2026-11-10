import { and, eq, isNull, sql } from 'drizzle-orm'
import type { db } from '../db/client.js'
import { auditLog, prospects, prospectTasks } from '../db/schema/index.js'
import { currentActor } from './request-context.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * A person leaves: their prospects go back to the free pool and their open tasks to whoever
 * disabled them. Runs inside the caller's transaction, so a failure leaves the account active
 * with everything still assigned. Lives in shared/ because team/ may not import from prospects/.
 */
export async function handOverDepartingUser(tx: Tx, userId: string, takeOverUserId: string) {
  const released = await tx
    .update(prospects)
    .set({ assignedUserId: null, claimedAt: null, updatedAt: new Date() })
    .where(and(eq(prospects.assignedUserId, userId), isNull(prospects.deletedAt)))
    .returning({ id: prospects.id })

  if (released.length > 0) {
    const actor = currentActor()
    await tx.insert(auditLog).values(
      released.map((row) => ({
        actorUserId: actor.userId,
        action: 'prospect.eliberat.plecare',
        entityType: 'prospect',
        entityId: row.id,
        changes: { assignedUserId: [userId, null] as [unknown, unknown] },
        ip: actor.ip,
      })),
    )
  }

  const tasks = await tx
    .update(prospectTasks)
    .set({ assigneeUserId: takeOverUserId, updatedAt: new Date() })
    .where(
      and(
        eq(prospectTasks.assigneeUserId, userId),
        isNull(prospectTasks.doneAt),
        isNull(prospectTasks.skippedAt),
        isNull(prospectTasks.deletedAt),
        // A task on a deleted prospect is not worth handing over.
        sql`EXISTS (SELECT 1 FROM ${prospects} p WHERE p.id = ${prospectTasks.prospectId} AND p.deleted_at IS NULL)`,
      ),
    )
    .returning({ id: prospectTasks.id })

  return { prospectCount: released.length, taskCount: tasks.length }
}
