import { db } from '../db/client.js'
import { notifications } from '../db/schema/index.js'
import { notifyPush } from './push.js'

export interface NotifyInput {
  kind: string
  title: string
  body?: string
  url?: string
  entityType?: string
  entityId?: string
  /** The person who caused it: they do not need to be told. */
  exceptUserId?: string
}

/** Each item addressed to one person; the title may differ per row (the release job writes each
 *  one in the owner's language). */
export async function notifyMany(items: Array<NotifyInput & { userId: string }>): Promise<void> {
  const rows = items.filter((item) => item.userId !== item.exceptUserId)
  if (rows.length === 0) return
  await db.insert(notifications).values(
    rows.map((item) => ({
      userId: item.userId,
      kind: item.kind,
      title: item.title,
      body: item.body ?? null,
      url: item.url ?? null,
      entityType: item.entityType ?? null,
      entityId: item.entityId ?? null,
    })),
  )
  // Push carries the title and the link only: a lock screen must not show a note's text.
  for (const item of rows) void notifyPush('clienti', { title: item.title, body: '', url: item.url }, [item.userId])
}

/** One bell row per person, the same text for all. */
export async function notify(userIds: string[], input: NotifyInput): Promise<void> {
  await notifyMany([...new Set(userIds)].map((userId) => ({ ...input, userId })))
}
