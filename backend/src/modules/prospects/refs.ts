import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { prospects, prospectStatuses, users } from '../../shared/db/schema/index.js'
import { registerRefType, type RefSnapshot } from '../../shared/lib/entity-refs.js'
import type { SessionUser } from '../../shared/lib/session.js'

const canSee = (me: SessionUser) => me.features.includes('clienti.view')

async function cards(ids: string[]): Promise<Map<string, RefSnapshot>> {
  const rows = await db
    .select({
      id: prospects.id,
      name: prospects.name,
      status: prospects.status,
      statusLabel: prospectStatuses.label,
      lastContactAt: prospects.lastContactedAt,
      ownerName: users.displayName,
      ownerEmail: users.email,
    })
    .from(prospects)
    .leftJoin(prospectStatuses, and(eq(prospectStatuses.key, prospects.status), isNull(prospectStatuses.deletedAt)))
    .leftJoin(users, eq(users.id, prospects.assignedUserId))
    .where(and(inArray(prospects.id, ids), isNull(prospects.deletedAt)))
  return new Map(
    rows.map((r) => [
      r.id,
      {
        title: r.name,
        ownerName: r.ownerName ?? r.ownerEmail ?? null,
        statusLabel: r.statusLabel ?? r.status,
        lastContactAt: r.lastContactAt?.toISOString() ?? null,
      },
    ]),
  )
}

registerRefType('prospect', {
  kind: 'firm',
  async snapshot(refId, sender) {
    if (!canSee(sender)) return null
    const card = (await cards([refId])).get(refId)
    return card ? { card } : null
  },
  async resolve(refIds, reader) {
    const live = await cards(refIds)
    return new Map(refIds.map((id) => [id, { canOpen: canSee(reader) && live.has(id), live: live.get(id), gone: !live.has(id) }]))
  },
})
