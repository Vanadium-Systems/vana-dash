import { sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { registerRefType } from '../../shared/lib/entity-refs.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { visibleCondition } from './service.js'

async function visibleEvents(me: SessionUser, ids: string[]) {
  if (!me.features.includes('calendar.view')) return []
  return db.execute<{
    id: string
    title: string
    startAt: string
    endAt: string
    allDay: boolean
    attendeeNames: string[]
  }>(sql`
    SELECT e."id", e."title", e."start_at" AS "startAt", e."end_at" AS "endAt", e."all_day" AS "allDay",
           COALESCE((
             SELECT json_agg(COALESCE(NULLIF(u."display_name", ''), u."email"))
               FROM "calendar_event_attendees" ca JOIN "users" u ON u."id" = ca."user_id"
              WHERE ca."event_id" = e."id" AND ca."deleted_at" IS NULL AND ca."user_id" <> e."owner_user_id"
           ), '[]'::json) AS "attendeeNames"
      FROM "calendar_events" e
     WHERE e."id" IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND e."deleted_at" IS NULL AND ${visibleCondition(me)}
  `)
}

registerRefType('calendar_event', {
  kind: 'personal',
  async snapshot(refId, sender) {
    const [row] = await visibleEvents(sender, [refId])
    if (!row) return null
    return {
      card: {
        title: row.title,
        startAt: new Date(row.startAt).toISOString(),
        endAt: new Date(row.endAt).toISOString(),
        allDay: row.allDay,
        attendeeNames: row.attendeeNames,
      },
    }
  },
  async resolve(refIds, reader) {
    const visible = new Set((await visibleEvents(reader, refIds)).map((r) => r.id))
    return new Map(refIds.map((id) => [id, { canOpen: visible.has(id) }]))
  },
})
