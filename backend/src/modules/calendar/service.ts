import { and, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import {
  calendarEventAttendees,
  calendarEventExceptions,
  calendarEventReminders,
  calendarEvents,
  calendarShares,
  users,
  type ExceptionOverrides,
} from '../../shared/db/schema/index.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { applyRevert, storeRevert, takeSnapshot } from './revert.js'
import { recordAudit } from '../../shared/lib/audit.js'
import type { SessionUser } from '../../shared/lib/session.js'
import type { CreateEventSchema, UpdateEventSchema } from './schema.js'
import type { z } from 'zod'

// Calendar per om (PLAN.md C2): evenimentul are un singur proprietar, iar cine mai vede un
// eveniment se decide din trei relații — share pe calendarul omului, participant la un
// eveniment comun, sau „toate calendarele" (admin / `calendar.administrare`). Tot ce e
// filtrat pe owner trăiește aici, lângă interogare, ca să fie vizibil lângă fiecare.

import {
  expandOccurrence,
  listOccurrences as listOccurrencesRaw,
  loadExceptions,
  rotateByDay,
  seriesStarts,
  wallDayDelta,
} from '../../shared/lib/calendar-occurrences.js'
import type { Occurrence } from '../../shared/lib/calendar-occurrences.js'
import { tr } from '../../shared/lib/i18n.js'
import { foldedIlike } from '../../shared/lib/text.js'

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
export function visibleCondition(me: SessionUser): SQL {
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
    throw new CalendarAccessError('EVENT_READ_ONLY', 403, tr('errors.calendar.viewOnly'))
  }
  return event
}

/** Participanții unui eveniment comun, deduși de owner (care e implicit participant). */
async function syncAttendees(tx: Tx, eventId: string, attendeeIds: string[] | undefined, ownerUserId: string) {
  await tx.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, eventId))
  const ids = [...new Set((attendeeIds ?? []).filter((id) => id !== ownerUserId))]
  if (ids.length > 0) await tx.insert(calendarEventAttendees).values(ids.map((userId) => ({ eventId, userId })))
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
    throw new CalendarAccessError('CALENDAR_READ_ONLY', 403, tr('errors.calendar.cannotAddToCalendar'))
  }
}

export type SeriesScope = 'occurrence' | 'following' | 'all'
export interface ScopeInput {
  scope?: SeriesScope
  /** The occurrence's key (where the series put it), required for `occurrence` and `following`. */
  occurrence?: Date
}

type EventFullRow = typeof calendarEvents.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Every write answers with the row and a token for the undo toast (revert.ts). */
export interface WriteResult<T> {
  data: T
  revertToken: string
}

/** A series row as values for a new row: no id, timestamps or company (they come from defaults). */
function rowCopy(row: EventFullRow): Omit<EventFullRow, 'id' | 'createdAt' | 'updatedAt' | 'tenantId'> {
  const copy: Partial<EventFullRow> = { ...row }
  delete copy.id
  delete copy.createdAt
  delete copy.updatedAt
  delete copy.tenantId
  return copy as Omit<EventFullRow, 'id' | 'createdAt' | 'updatedAt' | 'tenantId'>
}

async function loadRow(id: string): Promise<EventFullRow> {
  const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id))
  if (!row) throw new Error(`calendar event ${id} vanished`)
  return row
}

/** `reminders` wins; the old single `reminderMinutesBefore` (APK builds, assistant) maps to it. */
function remindersFrom(input: { reminders?: number[]; reminderMinutesBefore?: number | null }): number[] | undefined {
  if (input.reminders) return [...new Set(input.reminders)]
  if (input.reminderMinutesBefore === undefined) return undefined
  return input.reminderMinutesBefore === null ? [] : [input.reminderMinutesBefore]
}

/** Replaces the reminder set, keeping the dedup marker of offsets that stay. */
async function syncReminders(tx: Tx, eventId: string, minutes: number[]) {
  const current = await tx.select().from(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId))
  const keep = new Set(minutes)
  const gone = current.filter((r) => !keep.has(r.minutesBefore)).map((r) => r.id)
  if (gone.length > 0) await tx.delete(calendarEventReminders).where(inArray(calendarEventReminders.id, gone))
  const have = new Set(current.map((r) => r.minutesBefore))
  const added = minutes.filter((m) => !have.has(m))
  if (added.length > 0) await tx.insert(calendarEventReminders).values(added.map((minutesBefore) => ({ eventId, minutesBefore })))
}

async function assertAttendees(me: SessionUser, attendeeUserIds: string[] | undefined, ownerUserId: string) {
  if (!attendeeUserIds) return
  if (!canCreateCommon(me)) {
    throw new CalendarAccessError('COMMON_NOT_ALLOWED', 403, tr('errors.calendar.cannotAddAttendees'))
  }
  if (attendeeUserIds.includes(ownerUserId)) {
    throw new CalendarAccessError('ATTENDEE_IS_OWNER', 400, tr('errors.calendar.ownerAlreadyAttendee'))
  }
  if (attendeeUserIds.length > 0) {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.id} IN ${attendeeUserIds} AND ${users.deletedAt} IS NULL`)
    if (found.length !== new Set(attendeeUserIds).size) {
      throw new CalendarAccessError('ATTENDEE_NOT_FOUND', 400, tr('errors.calendar.attendeeGone'))
    }
  }
}

export async function createEvent(me: SessionUser, input: CreateEventInput): Promise<WriteResult<EventFullRow>> {
  const { attendeeUserIds = [], calendarOwnerUserId, reminders, reminderMinutesBefore, ...fields } = input
  const ownerUserId = calendarOwnerUserId ?? me.id
  if (ownerUserId !== me.id) await assertCanWriteCalendar(me, ownerUserId)
  // Un eveniment cu participanți e un eveniment comun: apare în calendarul fiecăruia, deci
  // doar cine are `calendar.comune` îl creează (decizie Stefan, 2026-09-30).
  await assertAttendees(me, attendeeUserIds.length > 0 ? attendeeUserIds : undefined, ownerUserId)
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(calendarEvents)
      .values({ ...fields, ownerUserId })
      .returning()
    if (!created) throw new Error(tr('errors.calendar.eventNotCreated'))
    await syncAttendees(tx, created.id, attendeeUserIds, ownerUserId)
    await syncReminders(tx, created.id, remindersFrom({ reminders, reminderMinutesBefore }) ?? [])
    return created
  })
  return { data: row, revertToken: storeRevert(me.id, await takeSnapshot([]), [row.id]) }
}

/** The occurrence key has to be one the series really produces, or the exception would be an orphan. */
async function requireOccurrence(row: EventFullRow, scope: ScopeInput): Promise<Date> {
  if (!scope.occurrence) throw new CalendarAccessError('OCCURRENCE_REQUIRED', 400, tr('errors.calendar.occurrenceRequired'))
  const timeZone = await getCompanyTimeZone()
  if (seriesStarts(row, scope.occurrence, scope.occurrence, timeZone).length === 0) {
    throw new CalendarAccessError('OCCURRENCE_NOT_IN_SERIES', 400, tr('errors.calendar.occurrenceNotInSeries'))
  }
  return scope.occurrence
}

function requireScope(row: EventFullRow, scope: ScopeInput): SeriesScope {
  if (!row.recurrenceRule) return 'all'
  if (!scope.scope) throw new CalendarAccessError('SCOPE_REQUIRED', 400, tr('errors.calendar.scopeRequired'))
  return scope.scope
}

/** Occurrence fields that can differ from the series. Anything else (rule, reminders, people)
 *  belongs to the series. */
function overridesFrom(input: UpdateEventInput): ExceptionOverrides {
  const overrides: ExceptionOverrides = {}
  if (input.title !== undefined) overrides.title = input.title
  if (input.location !== undefined) overrides.location = input.location
  if (input.description !== undefined) overrides.description = input.description
  if (input.color !== undefined) overrides.color = input.color
  return overrides
}

export async function updateEvent(
  me: SessionUser,
  id: string,
  input: UpdateEventInput & { attendeeUserIds?: string[] },
  scopeInput: ScopeInput = {},
): Promise<WriteResult<EventFullRow> | null> {
  const event = await requireEvent(me, id, 'edit')
  if (!event) return null
  if (input.attendeeUserIds && !canCreateCommon(me)) {
    throw new CalendarAccessError('COMMON_NOT_ALLOWED', 403, tr('errors.calendar.cannotChangeAttendees'))
  }
  if (input.attendeeUserIds?.includes(event.ownerUserId)) {
    throw new CalendarAccessError('ATTENDEE_IS_OWNER', 400, tr('errors.calendar.creatorAlreadyAttendee'))
  }
  const row = await loadRow(id)
  const scope = requireScope(row, scopeInput)
  const timeZone = await getCompanyTimeZone()

  if (scope === 'occurrence') {
    const key = await requireOccurrence(row, scopeInput)
    const before = await takeSnapshot([id])
    const durationMs = row.endAt.getTime() - row.startAt.getTime()
    const [existing] = await db
      .select()
      .from(calendarEventExceptions)
      .where(and(eq(calendarEventExceptions.eventId, id), eq(calendarEventExceptions.occurrenceStart, key)))
    const startAt = input.startAt ?? existing?.startAt ?? key
    const endAt = input.endAt ?? existing?.endAt ?? new Date(startAt.getTime() + durationMs)
    const overrides = { ...(existing?.overrides ?? {}), ...overridesFrom(input) }
    await db
      .insert(calendarEventExceptions)
      .values({ eventId: id, occurrenceStart: key, kind: 'moved', startAt, endAt, overrides })
      .onConflictDoUpdate({
        target: [calendarEventExceptions.tenantId, calendarEventExceptions.eventId, calendarEventExceptions.occurrenceStart],
        set: { kind: 'moved', startAt, endAt, overrides, deletedAt: null, updatedAt: new Date() },
      })
    return { data: row, revertToken: storeRevert(me.id, before, []) }
  }

  if (scope === 'following') {
    const key = await requireOccurrence(row, scopeInput)
    if (key.getTime() !== row.startAt.getTime()) {
      const before = await takeSnapshot([id])
      const created = await splitSeries(row, key, input, timeZone)
      return { data: created, revertToken: storeRevert(me.id, before, [created.id]) }
    }
    // "This and following" from the first occurrence is the whole series.
  }

  const before = await takeSnapshot([id])
  const { attendeeUserIds, reminders, reminderMinutesBefore, ...fields } = input
  const patch: Partial<typeof calendarEvents.$inferInsert> = { ...fields, updatedAt: new Date() }
  // A series moved to another weekday keeps repeating on the new days, unless the client sent
  // the rule itself.
  if (row.recurrenceRule && input.recurrenceRule === undefined && input.startAt) {
    const delta = wallDayDelta(row.startAt, input.startAt, timeZone)
    if (delta !== 0) patch.recurrenceRule = rotateByDay(row.recurrenceRule, delta)
  }
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(calendarEvents)
      .set(patch)
      .where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt)))
      .returning()
    if (attendeeUserIds) await syncAttendees(tx, id, attendeeUserIds, event.ownerUserId)
    const minutes = remindersFrom({ reminders, reminderMinutesBefore })
    if (minutes) await syncReminders(tx, id, minutes)
    return result
  })
  if (!updated) return null
  return { data: updated, revertToken: storeRevert(me.id, before, []) }
}

/**
 * "This and following": the old series ends just before `key`, a new one starts there with the
 * edits applied. Reminders and people are copied, and the exceptions from `key` on move to the
 * new series. A COUNT in the rule is split between the two.
 */
async function splitSeries(row: EventFullRow, key: Date, input: UpdateEventInput & { attendeeUserIds?: string[] }, timeZone: string) {
  const durationMs = row.endAt.getTime() - row.startAt.getTime()
  const startAt = input.startAt ?? key
  const endAt = input.endAt ?? new Date(startAt.getTime() + durationMs)
  let rule = input.recurrenceRule === undefined ? row.recurrenceRule : input.recurrenceRule
  if (input.recurrenceRule === undefined && rule) {
    const delta = wallDayDelta(key, startAt, timeZone)
    if (delta !== 0) rule = rotateByDay(rule, delta)
    const count = /(?:^|;)COUNT=(\d+)/i.exec(rule)
    if (count) {
      const used = seriesStarts(row, row.startAt, new Date(key.getTime() - 1000), timeZone).length
      rule = rule.replace(/COUNT=\d+/i, `COUNT=${Math.max(1, Number(count[1]) - used)}`)
    }
  }
  const { attendeeUserIds, reminders, reminderMinutesBefore, ...fields } = input

  return db.transaction(async (tx) => {
    // Cut the old series one second before the occurrence; a COUNT there would still reach past
    // the cut, so it goes and the end date takes over.
    const oldRule = row.recurrenceRule!.replace(/;?COUNT=\d+/i, '').replace(/^;/, '')
    await tx
      .update(calendarEvents)
      .set({ recurrenceEndAt: new Date(key.getTime() - 1000), recurrenceRule: oldRule, updatedAt: new Date() })
      .where(eq(calendarEvents.id, row.id))
    const copy = rowCopy(row)
    const [created] = await tx
      .insert(calendarEvents)
      .values({ ...copy, ...fields, startAt, endAt, recurrenceRule: rule, reminderSentAt: null })
      .returning()
    if (!created) throw new Error(tr('errors.calendar.eventNotCreated'))

    const people = attendeeUserIds ?? (await tx.select().from(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, row.id))).map((a) => a.userId)
    await syncAttendees(tx, created.id, people, created.ownerUserId)
    const minutes =
      remindersFrom({ reminders, reminderMinutesBefore }) ??
      (await tx.select().from(calendarEventReminders).where(eq(calendarEventReminders.eventId, row.id))).map((r) => r.minutesBefore)
    await syncReminders(tx, created.id, minutes)
    await tx
      .update(calendarEventExceptions)
      .set({ eventId: created.id, updatedAt: new Date() })
      .where(and(eq(calendarEventExceptions.eventId, row.id), gte(calendarEventExceptions.occurrenceStart, key)))
    return created
  })
}

export async function deleteEvent(me: SessionUser, id: string, scopeInput: ScopeInput = {}): Promise<WriteResult<EventFullRow> | null> {
  const event = await requireEvent(me, id, 'edit')
  if (!event) return null
  const row = await loadRow(id)
  const scope = requireScope(row, scopeInput)
  const before = await takeSnapshot([id])

  if (scope === 'occurrence') {
    const key = await requireOccurrence(row, scopeInput)
    await db
      .insert(calendarEventExceptions)
      .values({ eventId: id, occurrenceStart: key, kind: 'cancelled', startAt: null, endAt: null })
      .onConflictDoUpdate({
        target: [calendarEventExceptions.tenantId, calendarEventExceptions.eventId, calendarEventExceptions.occurrenceStart],
        set: { kind: 'cancelled', startAt: null, endAt: null, deletedAt: null, updatedAt: new Date() },
      })
    return { data: row, revertToken: storeRevert(me.id, before, []) }
  }

  if (scope === 'following') {
    const key = await requireOccurrence(row, scopeInput)
    if (key.getTime() !== row.startAt.getTime()) {
      const [updated] = await db
        .update(calendarEvents)
        .set({
          recurrenceEndAt: new Date(key.getTime() - 1000),
          recurrenceRule: row.recurrenceRule!.replace(/;?COUNT=\d+/i, '').replace(/^;/, ''),
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, id))
        .returning()
      return { data: updated!, revertToken: storeRevert(me.id, before, []) }
    }
  }

  const [deleted] = await db.update(calendarEvents).set({ deletedAt: new Date() }).where(eq(calendarEvents.id, id)).returning()
  return { data: deleted!, revertToken: storeRevert(me.id, before, []) }
}

/**
 * A copy of the event in the same calendar when the person may write there, otherwise in their
 * own. From an occurrence of a series the copy is a single event at that occurrence's time.
 */
export async function duplicateEvent(me: SessionUser, id: string, occurrence?: Date): Promise<WriteResult<EventFullRow> | null> {
  const event = await requireEvent(me, id, 'view')
  if (!event) return null
  const row = await loadRow(id)
  const ownerUserId = event.access === 'view' ? me.id : row.ownerUserId
  const [occ] = occurrence ? await expandSingle(row, occurrence) : []
  const durationMs = row.endAt.getTime() - row.startAt.getTime()
  const startAt = occ ? new Date(occ.occurrenceStart) : row.startAt
  const endAt = occ ? new Date(occ.occurrenceEnd) : new Date(startAt.getTime() + durationMs)

  const created = await db.transaction(async (tx) => {
    const copy = rowCopy(row)
    const [inserted] = await tx
      .insert(calendarEvents)
      .values({
        ...copy,
        ...(occ ? { title: occ.title, location: occ.location, description: occ.description, color: occ.color } : {}),
        ownerUserId,
        source: 'manual',
        startAt,
        endAt,
        recurrenceRule: occ ? null : row.recurrenceRule,
        recurrenceEndAt: occ ? null : row.recurrenceEndAt,
        reminderSentAt: null,
        createdByUserId: me.id,
        updatedByUserId: me.id,
      })
      .returning()
    if (!inserted) throw new Error(tr('errors.calendar.eventNotCreated'))
    if (canCreateCommon(me)) {
      const people = (await tx.select().from(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, id))).map((a) => a.userId)
      await syncAttendees(tx, inserted.id, people, ownerUserId)
    }
    const minutes = (await tx.select().from(calendarEventReminders).where(eq(calendarEventReminders.eventId, id))).map((r) => r.minutesBefore)
    await syncReminders(tx, inserted.id, minutes)
    return inserted
  })
  return { data: created, revertToken: storeRevert(me.id, await takeSnapshot([]), [created.id]) }
}

/** One occurrence of a series by its key, with its exception applied. */
async function expandSingle(row: EventFullRow, key: Date) {
  const timeZone = await getCompanyTimeZone()
  const exceptions = await loadExceptions([row.id])
  const durationMs = row.endAt.getTime() - row.startAt.getTime()
  return expandOccurrence(row, new Date(key.getTime() - 366 * 86_400_000), new Date(key.getTime() + 366 * 86_400_000 + durationMs), timeZone, exceptions).filter(
    (occ) => occ.occurrenceKey === key.toISOString(),
  )
}

export interface CalendarSearchHit {
  eventId: string
  title: string
  location: string | null
  color: string | null
  allDay: boolean
  ownerName: string
  occurrenceStart: string
  occurrenceEnd: string
  occurrenceKey: string | null
}

const YEAR_MS = 366 * 86_400_000

/**
 * Search inside the Calendar page: same visibility as the list, diacritics ignored. Each event
 * comes with its next occurrence, or its last one when the series is over.
 */
export async function searchCalendar(me: SessionUser, term: string): Promise<CalendarSearchHit[]> {
  // visibleCondition is written against the alias `e`, so the match runs as raw SQL.
  const matches = await db.execute<{ id: string }>(sql`
    SELECT e."id" FROM "calendar_events" e
     WHERE e."deleted_at" IS NULL
       AND (${foldedIlike(sql`e."title"`, term)} OR ${foldedIlike(sql`coalesce(e."location", '')`, term)})
       AND ${visibleCondition(me)}
     ORDER BY e."start_at" DESC
     LIMIT 30
  `)
  const ids = [...matches].map((m) => m.id)
  if (ids.length === 0) return []
  const rows = await db
    .select({ event: calendarEvents, ownerName: sql<string>`COALESCE(NULLIF(${users.displayName}, ''), ${users.email})` })
    .from(calendarEvents)
    .innerJoin(users, eq(users.id, calendarEvents.ownerUserId))
    .where(inArray(calendarEvents.id, ids))
  const timeZone = await getCompanyTimeZone()
  const exceptions = await loadExceptions(rows.filter((r) => r.event.recurrenceRule).map((r) => r.event.id))
  const now = new Date()
  const hits: CalendarSearchHit[] = []
  for (const { event, ownerName } of rows) {
    const row = { ...event, ownerName }
    const occ =
      expandOccurrence(row, now, new Date(now.getTime() + YEAR_MS), timeZone, exceptions)[0] ??
      expandOccurrence(row, new Date(now.getTime() - YEAR_MS), now, timeZone, exceptions).at(-1) ??
      (event.recurrenceRule ? null : expandOccurrence(row, event.startAt, event.endAt, timeZone)[0])
    if (!occ) continue
    hits.push({
      eventId: event.id,
      title: occ.title,
      location: occ.location,
      color: occ.color,
      allDay: occ.allDay,
      ownerName,
      occurrenceStart: occ.occurrenceStart,
      occurrenceEnd: occ.occurrenceEnd,
      occurrenceKey: occ.occurrenceKey,
    })
  }
  return hits
}

export async function revertWrite(me: SessionUser, token: string): Promise<boolean> {
  return applyRevert(me.id, token)
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
  throw new CalendarAccessError('SHARE_NOT_ALLOWED', 403, tr('errors.calendar.shareOwnOnly'))
}

export async function setCalendarShare(me: SessionUser, ownerUserId: string, userId: string, level: 'view' | 'edit') {
  assertCanShare(me, ownerUserId)
  if (userId === ownerUserId) throw new CalendarAccessError('SHARE_SELF', 400, tr('errors.calendar.shareWithSelf'))
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!target) throw new CalendarAccessError('USER_NOT_FOUND', 404, tr('errors.calendar.userGone'))
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