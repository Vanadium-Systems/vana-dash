import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client.js'
import { prospectCollaborators, prospects, users } from '../db/schema/index.js'
import type { SessionUser } from './session.js'

// Who sees and who edits a prospect. Every read of prospects (list, sheet, timeline, Ctrl K, the
// Messages card, export, board, lists, alerts) goes through `visibleProspectsWhere`; every write
// through `canEditProspect`. Lives in shared/ because search and email need it too.

const isCollaborator = (userId: string, level?: 'edit') =>
  sql`EXISTS (SELECT 1 FROM ${prospectCollaborators} pc
               WHERE pc."prospect_id" = ${prospects.id} AND pc."user_id" = ${userId} AND pc."deleted_at" IS NULL
               ${level ? sql`AND pc."level" = ${level}` : sql``})`

/** `clienti.toti` sees everything; otherwise: mine, unassigned, and where I am a collaborator. */
export function visibleProspectsWhere(me: Pick<SessionUser, 'id' | 'features'>): SQL {
  if (me.features.includes('clienti.toti')) return sql`true`
  return sql`(${prospects.assignedUserId} = ${me.id} OR ${prospects.assignedUserId} IS NULL OR ${isCollaborator(me.id)})`
}

export function canReassign(me: Pick<SessionUser, 'features'>): boolean {
  return me.features.includes('clienti.repartizare')
}

/** Admin / `clienti.repartizare`, the owner, or an `edit` collaborator. A free prospect is
 *  edited only after "I'll take it". */
export async function canEditProspect(
  me: Pick<SessionUser, 'id' | 'features'>,
  prospect: { id: string; assignedUserId: string | null },
): Promise<boolean> {
  if (!me.features.includes('clienti.prospectare')) return false
  if (canReassign(me)) return true
  if (prospect.assignedUserId === me.id) return true
  const [row] = await db
    .select({ id: prospectCollaborators.id })
    .from(prospectCollaborators)
    .where(
      and(
        eq(prospectCollaborators.prospectId, prospect.id),
        eq(prospectCollaborators.userId, me.id),
        eq(prospectCollaborators.level, 'edit'),
        isNull(prospectCollaborators.deletedAt),
      ),
    )
  return Boolean(row)
}

/** SQL twin of `canEditProspect`, for bulk actions and the `canEdit` column of the list. */
export function editableProspectsWhere(me: Pick<SessionUser, 'id' | 'features'>): SQL {
  if (!me.features.includes('clienti.prospectare')) return sql`false`
  if (canReassign(me)) return sql`true`
  return sql`(${prospects.assignedUserId} = ${me.id} OR ${isCollaborator(me.id, 'edit')})`
}

/** A visible, live prospect, or undefined (the caller answers 404). */
export async function findVisibleProspect(me: Pick<SessionUser, 'id' | 'features'>, id: string) {
  const [row] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.id, id), isNull(prospects.deletedAt), visibleProspectsWhere(me)))
  return row
}

export class ProspectNotYoursError extends Error {
  readonly code = 'PROSPECT_NOT_YOURS'
  constructor(public readonly ownerName: string | null) {
    super('PROSPECT_NOT_YOURS')
  }
}

export async function ownerNameOf(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, userId))
  return row ? (row.displayName ?? row.email) : null
}

/** Visible and editable, or throws: undefined → 404 by the caller, not editable → 403. */
export async function requireEditableProspect(me: Pick<SessionUser, 'id' | 'features'>, id: string) {
  const prospect = await findVisibleProspect(me, id)
  if (!prospect) return undefined
  if (!(await canEditProspect(me, prospect))) throw new ProspectNotYoursError(await ownerNameOf(prospect.assignedUserId))
  return prospect
}

/** `%`, `_` and `\` in a user's text must not act as LIKE wildcards. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}
