import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { calendarEventAttendees, calendarEvents, calendarShares, users } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import type { SessionUser } from '../../shared/lib/session.js'
import type { CreateEventSchema, UpdateEventSchema } from './schema.js'
import type { z } from 'zod'

// Calendar per om (PLAN.md C2): evenimentul are un singur proprietar, iar cine mai vede un
// eveniment se decide din trei relații — share pe calendarul omului, participant la un
// eveniment comun, sau „toate calendarele" (admin / `calendar.administrare`). Tot ce e
// filtrat pe owner trăiește aici, lângă interogare, ca să fie vizibil lângă fiecare.

import { listOccurrences as listOccurrencesRaw } from '../../shared/lib/calendar-occurrences.js'
import type { Occurrence } from '../../shared/lib/calendar-occurrences.js'

// Ocurențele (RRULE, cheltuieli recurente) trăiesc în shared/lib, folosite și de programări.
export { expandOccurrence, listOccurrencesForOwner } from '../../shared/lib/calendar-occurrences.js'

/** Ocurențele pe care omul le vede — starea de mai sus decide ce intră în listă. */
export async function listOccurrences(me: SessionUser, from: Date, to: Date): Promise<Occurrence[]> {
  return listOccurrencesRaw(from, to, { me, condition: visibleCondition(me) })
}

type CreateEventInput = z.infer<typeof CreateEventSchema>
type UpdateEventInput = z.infer<typeof UpdateEventSchema>

export class CalendarAccessError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const managesAllCalendars = (me: SessionUser) => me.features.includes('calendar.administrare')
const canCreateCommon = (me: SessionUser) => me.features.includes('calendar.comune')

/**
 * Ce poate face omul cu un eveniment. `owner` e singurul nivel de scriere „de la capat"; un
 * calendar partajat „editează" scrie direct în calendarul altcuia (cazul secretarului), iar un
 * eveniment comun se scrie doar cu `calendar.comune` — un participant fără ea doar privește.
 */
export type EventAccess = 'owner' | 'edit' | 'view'

/** Condiția SQL „omul vede evenimentul", pentru lista de ocurențe. */
function visibleCondition(me: SessionUser): SQL {
  const manageAll = managesAllCalendars(me)
  return sql`(
    e."owner_user_id" = ${me.id}
    OR EXISTS (
      SELECT 1 FROM "calendar_shares" cs
       WHERE cs."owner_user_id" = e."owner_user_id" AND cs."user_id" = ${me.id} AND cs."deleted_at" IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM "calendar_event_attendees" ca
       WHERE ca."event_id" = e."id" AND ca."user_id" = ${me.id} AND ca."deleted_at" IS NULL
    )
    ${manageAll ? sql`OR TRUE` : sql``}
  )`
}

/** Evenimentele care se potrivesc cu termenul, doar din ce vede omul — pentru Ctrl K. */
export async function searchEvents(me: SessionUser, term: string, limit: number) {
  const like = `%${term}%`
  return db.execute<{ id: string; title: string; startAt: string; allDay: boolean; ownerUserId: string; ownerName: string }>(sql`
    SELECT e."id", e."title", e."start_at" AS "startAt", e."all_day" AS "allDay",
           e."owner_user_id" AS "ownerUserId",
           COALESCE(NULLIF(u."display_name", ''), u."email") AS "ownerName"
      FROM "calendar_events" e
      JOIN "users" u ON u."id" = e."owner_user_id"
     WHERE e."deleted_at" IS NULL
       AND (e."title" ILIKE ${like} OR e."location" ILIKE ${like})
       AND ${visibleCondition(me)}
     ORDER BY e."start_at" DESC
     LIMIT ${limit}
  `)
}

/** Evenimentul cu accesul omului calculat, pt. cereri directe după id. */
async function loadEvent(me: SessionUser, id: string) {
  const rows = await db.execute<{
    id: string
    ownerUserId: string
    ownerName: string
    shareLevel: 'view' | 'edit' | null
    isAttendee: boolean
    isCommon: boolean
    attendees: { id: string; name: string }[]
  }>(sql`
    SELECT e."id", e."owner_user_id" AS "ownerUserId",
           COALESCE(NULLIF(u."display_name", ''), u."email") AS "ownerName",
           (SELECT cs."level" FROM "calendar_shares" cs
             WHERE cs."owner_user_id" = e."owner_user_id" AND cs."user_id" = ${me.id} AND cs."deleted_at" IS NULL) AS "shareLevel",
           EXISTS (SELECT 1 FROM "calendar_event_attendees" ca
                    WHERE ca."event_id" = e."id" AND ca."user_id" = ${me.id} AND ca."deleted_at" IS NULL) AS "isAttendee",
           EXISTS (SELECT 1 FROM "calendar_event_attendees" ca
                    WHERE ca."event_id" = e."id" AND ca."deleted_at" IS NULL) AS "isCommon",
           COALESCE((
             SELECT json_agg(json_build_object('id', u2."id", 'name', COALESCE(NULLIF(u2."display_name", ''), u2."email")))
               FROM "calendar_event_attendees" ca
               JOIN "users" u2 ON u2."id" = ca."user_id"
              WHERE ca."event_id" = e."id" AND ca."deleted_at" IS NULL AND ca."user_id" <> e."owner_user_id"
           ), '[]'::json) AS attendees
      FROM "calendar_events" e
      JOIN "users" u ON u."id" = e."owner_user_id"
     WHERE e."id" = ${id} AND e."deleted_at" IS NULL
  `)
  const row = rows[0]
  if (!row) return null
  if (!isVisible(me, row)) return null
  return { ...row, access: accessLevel(me, row) }
}

type EventRow = {
  ownerUserId: string
  shareLevel: 'view' | 'edit' | null
  isAttendee: boolean
  isCommon: boolean
}

function isVisible(me: SessionUser, row: EventRow): boolean {
  if (row.ownerUserId === me.id || row.shareLevel || row.isAttendee) return true
  return managesAllCalendars(me)
}

function accessLevel(me: SessionUser, row: EventRow): EventAccess {
  if (row.ownerUserId === me.id) return 'owner'
  if (row.shareLevel === 'edit') return 'edit'
  // Eveniment comun: doar cine are `calendar.comune` îl poate modifica, participant sau nu.
  if (row.isCommon && canCreateCommon(me)) return 'edit'
  return 'view'
}

/** Null = nu are acces deloc (răspunsul devine 404, ca la Arhivă). */
async function requireEvent(me: SessionUser, id: string, min: EventAccess) {
  const event = await loadEvent(me, id)
  if (!event) return null
  const order: EventAccess[] = ['view', 'edit', 'owner']
  if (order.indexOf(event.access) < order.indexOf(min)) {
    throw new CalendarAccessError('EVENT_READ_ONLY', 403, 'Poți vedea evenimentul, dar nu îl poți modifica')
  }
  return event
}

/** Participanții unui eveniment comun, deduși de owner (care e implicit participant). */
async function syncAttendees(eventId: string, attendeeIds: string[] | undefined, ownerUserId: string) {
  await db.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, eventId))
  const ids = [...new Set((attendeeIds ?? []).filter((id) => id !== ownerUserId))]
  if (ids.length > 0) await db.insert(calendarEventAttendees).values(ids.map((userId) => ({ eventId, userId })))
}

/** Scrierea în calendarul altcuia cere share „editează" pe el — „vede" sau nimic → 403. */
async function assertCanWriteCalendar(me: SessionUser, ownerUserId: string) {
  const [share] = await db
    .select({ level: calendarShares.level })
    .from(calendarShares)
    .where(
      and(
        eq(calendarShares.ownerUserId, ownerUserId),
        eq(calendarShares.userId, me.id),
        isNull(calendarShares.deletedAt),
      ),
    )
  if (share?.level !== 'edit') {
    throw new CalendarAccessError('CALENDAR_READ_ONLY', 403, 'Nu poți adăuga evenimente în acest calendar')
  }
}

export async function createEvent(me: SessionUser, input: CreateEventInput) {
  const { attendeeUserIds = [], calendarOwnerUserId, ...fields } = input
  const ownerUserId = calendarOwnerUserId ?? me.id
  if (ownerUserId !== me.id) await assertCanWriteCalendar(me, ownerUserId)
  // Un eveniment cu participanți e un eveniment comun: apare în calendarul fiecăruia, deci
  // doar cine are `calendar.comune` îl creează (decizie Stefan, 2026-09-30).
  if (attendeeUserIds.length > 0 && !canCreateCommon(me)) {
    throw new CalendarAccessError('COMMON_NOT_ALLOWED', 403, 'Nu poți crea evenimente cu participanți')
  }
  if (attendeeUserIds.includes(ownerUserId)) {
    throw new CalendarAccessError('ATTENDEE_IS_OWNER', 400, 'Proprietarul calendarului e deja participant')
  }
  if (attendeeUserIds.length > 0) {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.id} IN ${attendeeUserIds} AND ${users.deletedAt} IS NULL`)
    if (found.length !== new Set(attendeeUserIds).size) {
      throw new CalendarAccessError('ATTENDEE_NOT_FOUND', 400, 'Unul dintre participanți nu mai există')
    }
  }
  const [row] = await db
    .insert(calendarEvents)
    .values({ ...fields, ownerUserId })
    .returning()
  if (!row) throw new Error('Eveniment necreat')
  await syncAttendees(row.id, attendeeUserIds, ownerUserId)
  return row
}

export async function updateEvent(
  me: SessionUser,
  id: string,
  input: UpdateEventInput & { attendeeUserIds?: string[] },
) {
  const event = await requireEvent(me, id, 'edit')
  if (!event) return null
  if (input.attendeeUserIds && !canCreateCommon(me)) {
    throw new CalendarAccessError('COMMON_NOT_ALLOWED', 403, 'Nu poți modifica participanții evenimentului')
  }
  if (input.attendeeUserIds?.includes(event.ownerUserId)) {
    throw new CalendarAccessError('ATTENDEE_IS_OWNER', 400, 'Creatorul evenimentului e deja participant')
  }
  const patch: Partial<typeof calendarEvents.$inferInsert> = { ...input, updatedAt: new Date() }
  delete (patch as { attendeeUserIds?: string[] }).attendeeUserIds
  const [row] = await db
    .update(calendarEvents)
    .set(patch)
    .where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt)))
    .returning()
  if (input.attendeeUserIds) await syncAttendees(id, input.attendeeUserIds, event.ownerUserId)
  return row
}

export async function deleteEvent(me: SessionUser, id: string) {
  const event = await requireEvent(me, id, 'edit')
  if (!event) return null
  const [row] = await db
    .update(calendarEvents)
    .set({ deletedAt: new Date() })
    .where(eq(calendarEvents.id, id))
    .returning()
  return row
}

// ── Partajarea calendarului ─────────────────────────────────────────────

export interface CalendarShareRow {
  id: string
  userId: string
  level: 'view' | 'edit'
  displayName: string | null
  email: string
  /** true = calendarul e al omului din rând (l-am dat noi), false = ne l-a dat el. */
  ours: boolean
}

export interface CalendarsResponse {
  /** Calendarele omului: al lui + cele primite prin share. */
  mine: { userId: string; name: string; level: 'view' | 'edit'; owner: boolean }[]
  /** Share-urile pe care le-am dat noi, pentru dialogul „Partajează calendarul". */
  given: CalendarShareRow[]
  /** Toți oamenii cu calendar, pt. „Partajează" — plus adminul, care poate da oricui. */
  members: { id: string; displayName: string | null; email: string }[]
}

/** Layer-ele de calendar din UI: al meu + cele care mi-au fost partajate. */
export async function listCalendars(me: SessionUser): Promise<CalendarsResponse> {
  const [meRow] = await db
    .select({ id: users.id, name: sql<string>`COALESCE(NULLIF(${users.displayName}, ''), ${users.email})` })
    .from(users)
    .where(eq(users.id, me.id))

  const received = await db
    .select({
      userId: calendarShares.ownerUserId,
      level: calendarShares.level,
      name: sql<string>`COALESCE(NULLIF(${users.displayName}, ''), ${users.email})`,
    })
    .from(calendarShares)
    .innerJoin(users, eq(users.id, calendarShares.ownerUserId))
    .where(and(eq(calendarShares.userId, me.id), isNull(calendarShares.deletedAt), isNull(users.deletedAt)))
    .orderBy(sql`COALESCE(NULLIF(${users.displayName}, ''), ${users.email})`)

  const given = await db
    .select({
      id: calendarShares.id,
      userId: calendarShares.userId,
      level: calendarShares.level,
      displayName: users.displayName,
      email: users.email,
    })
    .from(calendarShares)
    .innerJoin(users, eq(users.id, calendarShares.userId))
    .where(
      and(
        eq(calendarShares.ownerUserId, me.id),
        isNull(calendarShares.deletedAt),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(users.displayName, users.email)

  const members = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(users.displayName, users.email)

  return {
    mine: [
      { userId: me.id, name: meRow?.name ?? me.email, level: 'edit', owner: true },
      ...received.map((r) => ({ userId: r.userId, name: r.name, level: r.level, owner: false })),
    ],
    given: given.map((r) => ({ ...r, ours: true })),
    members: members.filter((m) => m.id !== me.id),
  }
}

/** Share-ul îl dă doar proprietarul calendarului sau adminul — nu cine are doar „editează". */
function assertCanShare(me: SessionUser, ownerUserId: string) {
  if (ownerUserId === me.id || me.role?.kind === 'admin') return
  throw new CalendarAccessError('SHARE_NOT_ALLOWED', 403, 'Poți partaja doar calendarul tău')
}

export async function setCalendarShare(me: SessionUser, ownerUserId: string, userId: string, level: 'view' | 'edit') {
  assertCanShare(me, ownerUserId)
  if (userId === ownerUserId) throw new CalendarAccessError('SHARE_SELF', 400, 'Nu poți partaja calendarul cu tine însuți')
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!target) throw new CalendarAccessError('USER_NOT_FOUND', 404, 'Utilizatorul nu mai există')
  const [before] = await db
    .select({ level: calendarShares.level })
    .from(calendarShares)
    .where(
      and(
        eq(calendarShares.ownerUserId, ownerUserId),
        eq(calendarShares.userId, userId),
        isNull(calendarShares.deletedAt),
      ),
    )
  await db
    .insert(calendarShares)
    .values({ ownerUserId, userId, level })
    .onConflictDoUpdate({
      target: [calendarShares.ownerUserId, calendarShares.userId],
      set: { level, updatedAt: new Date(), deletedAt: null },
    })
  await recordAudit({
    action: 'calendar.share.adaugat',
    entityType: 'calendar_share',
    entityId: ownerUserId,
    changes: { calendar: [before?.level ?? null, level] },
  })
  return (await listCalendars(me)).given
}

export async function removeCalendarShare(me: SessionUser, ownerUserId: string, userId: string) {
  assertCanShare(me, ownerUserId)
  await db
    .update(calendarShares)
    .set({ deletedAt: new Date() })
    .where(and(eq(calendarShares.ownerUserId, ownerUserId), eq(calendarShares.userId, userId)))
  await recordAudit({
    action: 'calendar.share.scos',
    entityType: 'calendar_share',
    entityId: ownerUserId,
    changes: { calendar: [null, null] },
  })
  return (await listCalendars(me)).given
}