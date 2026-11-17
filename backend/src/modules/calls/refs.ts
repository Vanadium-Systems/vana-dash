import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { calls, conversationMembers } from '../../shared/db/schema/index.js'
import { registerRefType, type RefResolution } from '../../shared/lib/entity-refs.js'
import type { SessionUser } from '../../shared/lib/session.js'

// Video/audio calls shared as cards inside Mesaje. A call inside a conversation is visible to
// its members; an ad-hoc call requires `apeluri.view`.

async function visibleCalls(ids: string[], reader: SessionUser) {
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: calls.id,
      title: calls.title,
      kind: calls.kind,
      status: calls.status,
      conversationId: calls.conversationId,
      expiresAt: calls.expiresAt,
      durationSeconds: calls.durationSeconds,
    })
    .from(calls)
    .where(and(inArray(calls.id, ids), isNull(calls.deletedAt)))

  const convIds = [...new Set(rows.map((r) => r.conversationId).filter((v): v is string => Boolean(v)))]
  const memberConvIds = new Set<string>()
  if (convIds.length > 0 && reader.features.includes('mesaje.view')) {
    const memberships = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(
        and(
          inArray(conversationMembers.conversationId, convIds),
          eq(conversationMembers.userId, reader.id),
          isNull(conversationMembers.deletedAt),
        ),
      )
    for (const m of memberships) memberConvIds.add(m.conversationId)
  }

  return rows.filter((row) =>
    row.conversationId ? memberConvIds.has(row.conversationId) : reader.features.includes('apeluri.view'),
  )
}

registerRefType('call', {
  kind: 'personal',
  async snapshot(refId, sender) {
    const [row] = await visibleCalls([refId], sender)
    if (!row) return null
    const effectiveStatus = row.status === 'open' && row.expiresAt.getTime() <= Date.now() ? 'ended' : row.status
    return {
      card: {
        title: row.title,
        kind: row.kind,
        status: effectiveStatus,
        conversationId: row.conversationId,
      },
    }
  },
  async resolve(refIds, reader) {
    const visible = await visibleCalls(refIds, reader)
    const byId = new Map(visible.map((row) => [row.id, row]))
    return new Map<string, RefResolution>(
      refIds.map((id) => {
        const row = byId.get(id)
        if (!row) return [id, { canOpen: false }]
        const effectiveStatus = row.status === 'open' && row.expiresAt.getTime() <= Date.now() ? 'ended' : row.status
        return [
          id,
          {
            canOpen: Boolean(row.conversationId ? reader.features.includes('mesaje.view') : reader.features.includes('apeluri.manage')),
            live: {
              title: row.title,
              kind: row.kind,
              status: effectiveStatus,
              conversationId: row.conversationId,
              durationSeconds: row.durationSeconds,
            },
          },
        ]
      }),
    )
  },
})
