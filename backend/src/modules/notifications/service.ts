import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { notifications } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'

const PAGE_SIZE = 30

export async function listNotifications(me: SessionUser, cursor?: string) {
  const mine = and(eq(notifications.userId, me.id), isNull(notifications.deletedAt))
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(cursor ? and(mine, lt(notifications.createdAt, new Date(cursor))) : mine)
    .orderBy(desc(notifications.createdAt))
    .limit(PAGE_SIZE + 1)
  const page = rows.slice(0, PAGE_SIZE)
  const [counts] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(mine, isNull(notifications.readAt)))
  return {
    rows: page,
    nextCursor: rows.length > PAGE_SIZE ? (page[page.length - 1]?.createdAt.toISOString() ?? null) : null,
    unread: counts?.unread ?? 0,
  }
}

export async function markRead(me: SessionUser, input: { ids: string[] } | { all: true }) {
  const mine = and(eq(notifications.userId, me.id), isNull(notifications.readAt), isNull(notifications.deletedAt))
  const where = 'all' in input ? mine : and(mine, inArray(notifications.id, input.ids))
  const updated = await db.update(notifications).set({ readAt: new Date(), updatedAt: new Date() }).where(where).returning({ id: notifications.id })
  return { marked: updated.length }
}
