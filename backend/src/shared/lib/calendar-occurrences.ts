import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
// CJS default export (UMD bundle, no static named-export detection under Node ESM) — destructure manually.
import rrulePkg from 'rrule'
import { db } from '../db/client.js'
import { calendarEventExceptions, calendarEvents, recurringExpenses, type ExceptionOverrides } from '../db/schema/index.js'
import { getCompanyTimeZone } from './company.js'
import { wallClock, zonedTimeToUtc } from './schedule-recurrence.js'
import { computeNextOccurrence, dayAfter, type BillingCycle } from './billing-cycle.js'
import type { SessionUser } from './session.js'
import { tr } from './i18n.js'

// Ocurențele calendarului (evenimente + RRULE expandat + cheltuieli recurente), folosite de
// modules/calendar, de jobs/calendar-reminders.ts și de modules/booking (sloturile libere) —
// o singură implementare a recurenței.

type CalendarEventRow = typeof calendarEvents.$inferSelect

const { RRule } = rrulePkg

// Culoare fixă (nu una din paleta de eveniment) — semnalează vizual "generat din Accounting",
// nu un eveniment normal creat din Calendar.
const EXPENSE_COLOR = '#57534e'
// Safety net pt. bucla de mai jos (recurring_expenses nu are un capăt de recurență ca
// evenimentele) — 60 de pași acoperă 5 ani lunar sau 60 de ani anual, mult peste orice
// fereastră realistă cerută de UI (săptămână/lună).
const MAX_EXPENSE_OCCURRENCE_STEPS = 60

/** The exceptions of one series, as read from `calendar_event_exceptions`. */
export interface ExceptionRow {
  eventId: string
  occurrenceStart: Date
  kind: 'cancelled' | 'moved'
  startAt: Date | null
  endAt: Date | null
  overrides: ExceptionOverrides
}

const MINUTE_MS = 60_000

// The rule is expanded on the company's wall clock, not in UTC: a weekly meeting at 10:00 has to
// stay at 10:00 across a DST change. rrule has no usable time zone support (its `tzid` shifts the
// result by the offset twice), so the start goes in as a "floating" date whose UTC fields hold the
// wall time, and each occurrence comes back through zonedTimeToUtc.
function toFloating(instant: Date, timeZone: string): Date {
  const wall = wallClock(instant, timeZone)
  return new Date(Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min))
}

function fromFloating(floating: Date, timeZone: string): Date {
  return zonedTimeToUtc(
    floating.getUTCFullYear(),
    floating.getUTCMonth() + 1,
    floating.getUTCDate(),
    floating.getUTCHours(),
    floating.getUTCMinutes(),
    timeZone,
  )
}

/**
 * The occurrence starts of a series between two instants, as real UTC instants. All-day events
 * are dates, not moments, so they repeat in UTC as they were stored.
 */
export function seriesStarts(
  row: Pick<CalendarEventRow, 'startAt' | 'recurrenceRule' | 'recurrenceEndAt' | 'allDay'>,
  from: Date,
  to: Date,
  timeZone: string,
): Date[] {
  if (!row.recurrenceRule) return []
  const options = RRule.parseString(row.recurrenceRule)
  const until = row.recurrenceEndAt ?? options.until ?? null
  if (row.allDay) {
    return new RRule({ ...options, dtstart: row.startAt, until }).between(from, to, true)
  }
  const rule = new RRule({ ...options, dtstart: toFloating(row.startAt, timeZone), until: until ? toFloating(until, timeZone) : null })
  // A day of margin on both sides: the floating window is off by the zone's offset.
  const floatingFrom = new Date(toFloating(from, timeZone).getTime() - 1440 * MINUTE_MS)
  const floatingTo = new Date(toFloating(to, timeZone).getTime() + 1440 * MINUTE_MS)
  return rule
    .between(floatingFrom, floatingTo, true)
    .map((floating) => fromFloating(floating, timeZone))
    .filter((start) => start >= from && start <= to)
}

/**
 * Expandarea RRULE nu e o agregare SQL (SUM/AVG/GROUP BY) — e generare de date via
 * librăria `rrule`, care nu are echivalent în Postgres. JS e locul corect pt. asta
 * (nu încalcă regula #9 CLAUDE.md); volum mic (calendar personal, un user).
 *
 * Exceptions: a cancelled occurrence drops out, a moved one shows at its new time with its
 * overrides, and one moved into the window from outside it shows as well.
 */
export function expandOccurrence(
  row: CalendarEventRow & Partial<OccurrenceMeta>,
  from: Date,
  to: Date,
  timeZone: string,
  exceptions: ExceptionRow[] = [],
): Occurrence[] {
  if (!row.recurrenceRule) {
    if (row.startAt > to || row.endAt < from) return []
    return [toOccurrence(row, row.startAt, row.endAt, null)]
  }

  const durationMs = row.endAt.getTime() - row.startAt.getTime()
  // Starts from one duration earlier, so an occurrence that began before `from` and is still
  // running shows too.
  const starts = seriesStarts(row, new Date(from.getTime() - durationMs), to, timeZone)
  const byKey = new Map(exceptions.filter((ex) => ex.eventId === row.id).map((ex) => [ex.occurrenceStart.getTime(), ex]))

  const occurrences: Occurrence[] = []
  for (const start of starts) {
    const exception = byKey.get(start.getTime())
    byKey.delete(start.getTime())
    if (exception?.kind === 'cancelled') continue
    if (exception?.kind === 'moved') {
      const moved = movedOccurrence(row, start, exception)
      if (moved && overlaps(moved, from, to)) occurrences.push(moved)
      continue
    }
    const end = new Date(start.getTime() + durationMs)
    if (end >= from) occurrences.push(toOccurrence(row, start, end, start))
  }
  // Moved here from a day outside the window. Only keys the series still produces count, so a
  // series cut short or with a changed rule leaves no orphan behind.
  for (const exception of byKey.values()) {
    if (exception.kind !== 'moved') continue
    const moved = movedOccurrence(row, exception.occurrenceStart, exception)
    if (!moved || !overlaps(moved, from, to)) continue
    const key = exception.occurrenceStart
    if (seriesStarts(row, key, key, timeZone).length === 0) continue
    occurrences.push(moved)
  }
  return occurrences
}

function movedOccurrence(row: CalendarEventRow & Partial<OccurrenceMeta>, key: Date, exception: ExceptionRow): Occurrence | null {
  if (!exception.startAt || !exception.endAt) return null
  const overrides = exception.overrides
  return toOccurrence(
    {
      ...row,
      title: overrides.title ?? row.title,
      location: overrides.location !== undefined ? overrides.location : row.location,
      description: overrides.description !== undefined ? overrides.description : row.description,
      color: overrides.color !== undefined ? overrides.color : row.color,
    },
    exception.startAt,
    exception.endAt,
    key,
    true,
  )
}

function overlaps(occ: Occurrence, from: Date, to: Date): boolean {
  return new Date(occ.occurrenceStart) <= to && new Date(occ.occurrenceEnd) >= from
}

/**
 * Moves the weekdays of a rule by `dayDelta` days (MO,WE +1 → TU,TH), so a series dragged to
 * another weekday keeps repeating on the new days. Ordinals stay (+4TH +1 → +4FR); every other
 * part of the rule is left as it was.
 */
export function rotateByDay(rule: string, dayDelta: number): string {
  const shift = ((dayDelta % 7) + 7) % 7
  if (shift === 0) return rule
  const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
  return rule
    .split(';')
    .map((part) => {
      const [key, value] = part.split('=')
      if (key?.toUpperCase() !== 'BYDAY' || !value) return part
      const rotated = value.split(',').map((token) => {
        const match = /^([+-]?\d*)([A-Z]{2})$/i.exec(token.trim())
        if (!match) return token
        const index = days.indexOf(match[2]!.toUpperCase())
        return index < 0 ? token : `${match[1]}${days[(index + shift) % 7]}`
      })
      return `${key}=${rotated.join(',')}`
    })
    .join(';')
}

/** Days between two instants on the company's calendar (not 24h blocks), for rotateByDay. */
export function wallDayDelta(before: Date, after: Date, timeZone: string): number {
  const a = wallClock(before, timeZone)
  const b = wallClock(after, timeZone)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / (1440 * MINUTE_MS))
}

export interface Occurrence {
  eventId: string
  kind: 'event' | 'expense'
  // 'manual' | 'booking' pt. evenimente; 'manual' pt. cheltuieli.
  source: string
  title: string
  description: string | null
  location: string | null
  allDay: boolean
  color: string | null
  isRecurring: boolean
  recurrenceRule: string | null
  recurrenceEndAt: string | null
  occurrenceStart: string
  occurrenceEnd: string
  /** Where the series put this occurrence (its key for exceptions), even after it was moved;
   *  null for a single event and for expenses. */
  occurrenceKey: string | null
  /** Moved or edited on its own, apart from its series. */
  isException: boolean
  /** Start and end of the event row itself (the first occurrence of a series), so editing an
   *  occurrence saves the series without moving it to the clicked day. */
  seriesStart: string
  seriesEnd: string
  // Doar pt. kind='event' — necesar ca EventFormDialog.tsx (FE) să prefill-uiască reminder-ul
  // existent la editare din click pe ocurență (singura cale de edit, nu există GET /events/:id).
  // null pt. ocurențele 'expense' (recurring_expenses nu au reminder).
  reminderMinutesBefore: number | null
  /** Every reminder of the event, in minutes before it (calendar_event_reminders). */
  reminders: number[]
  /** Cui îi aparține calendarul (null pt. cheltuieli) + numele omului, ca un eveniment dintr-un
   *  calendar partajat să poarte numele omului și nu doar o culoare (regula de accesibilitate). */
  ownerUserId: string | null
  ownerName: string | null
  /** Participanții unui eveniment comun (fără creatorul, care e participant implicit). */
  attendees: { id: string; name: string }[]
  isCommon: boolean
  /** Dreptul omului care a cerut lista: 'owner' | 'edit' | 'view'. */
  access: 'owner' | 'edit' | 'view' | null
}

function toOccurrence(
  row: CalendarEventRow & Partial<OccurrenceMeta>,
  occurrenceStart: Date,
  occurrenceEnd: Date,
  occurrenceKey: Date | null,
  isException = false,
): Occurrence {
  return {
    eventId: row.id,
    kind: 'event',
    source: row.source,
    title: row.title,
    description: row.description,
    location: row.location,
    allDay: row.allDay,
    color: row.color,
    isRecurring: row.recurrenceRule !== null,
    // Incluse ca editarea din UI (click pe o ocurență) să poată prefill formularul de
    // recurență fără o cerere separată GET /events/:id (nu există — nu era nevoie de ea).
    recurrenceRule: row.recurrenceRule,
    recurrenceEndAt: row.recurrenceEndAt ? row.recurrenceEndAt.toISOString() : null,
    occurrenceStart: occurrenceStart.toISOString(),
    occurrenceEnd: occurrenceEnd.toISOString(),
    occurrenceKey: occurrenceKey ? occurrenceKey.toISOString() : null,
    isException,
    seriesStart: row.startAt.toISOString(),
    seriesEnd: row.endAt.toISOString(),
    reminderMinutesBefore: row.reminders?.[0] ?? null,
    reminders: row.reminders ?? [],
    ownerUserId: row.ownerUserId ?? null,
    ownerName: row.ownerName ?? null,
    attendees: row.attendees ?? [],
    isCommon: (row.attendees?.length ?? 0) > 0,
    access: row.access ?? null,
  }
}

/**
 * `db.execute` cu SQL crud întoarce coloanele timestamptz ca șiruri, nu ca `Date` — iar
 * `expandOccurrence` are nevoie de `Date` (dtstart pentru RRule, comparații). Deci mapăm o dată,
 * aici, unde se știe exact ce coloane sunt dată.
 */
function hydrate(row: CalendarEventRow & Partial<OccurrenceMeta>): CalendarEventRow & Partial<OccurrenceMeta> {
  // Rândul vine ca `any` de la `db.execute`, deci tipul declarat nu ajută: coerciunea e locală.
  const raw = row as unknown as Record<string, string | Date | null>
  const date = (key: string): Date => new Date(raw[key] as string)
  const dateOrNull = (key: string): Date | null => (raw[key] ? new Date(raw[key] as string) : null)
  return {
    ...row,
    createdAt: date('createdAt'),
    updatedAt: date('updatedAt'),
    deletedAt: dateOrNull('deletedAt'),
    startAt: date('startAt'),
    endAt: date('endAt'),
    recurrenceEndAt: dateOrNull('recurrenceEndAt'),
  }
}

/** Datele de context ale unui rând de eveniment, aduse o singură dată pentru toată fereastra.
 *  Alias, nu `interface`, fiindcă `db.execute<T>` cere un tip cu index implicit — o interfață
 *  nu-l are. */
export type OccurrenceMeta = {
  ownerUserId: string
  ownerName: string
  attendees?: { id: string; name: string }[]
  reminders?: number[]
  access?: 'owner' | 'edit' | 'view'
}

/**
 * Ocurențe virtuale (nemateralizate — la fel ca RRULE mai sus) din recurring_expenses cu
 * showInCalendar=true. Reutilizează computeNextOccurrence/dayAfter din shared/lib/billing-cycle.ts
 * (aceeași funcție folosită de jobs/recurring-expenses.ts la rostogolirea reală) — nicio
 * duplicare de logică de cadență, doar simulăm rostogolirea înainte fără s-o scriem în DB.
 * Nu arată scadențe TRECUTE (nextDueDate e mereu "următoarea", cele consumate sunt deja
 * financial_records) — calendarul e despre planificare, nu istoric.
 */
async function listRecurringExpenseOccurrences(from: Date, to: Date) {
  const expenses = await db
    .select()
    .from(recurringExpenses)
    .where(
      and(
        isNull(recurringExpenses.deletedAt),
        eq(recurringExpenses.active, true),
        eq(recurringExpenses.showInCalendar, true),
      ),
    )

  const occurrences: Occurrence[] = []
  for (const expense of expenses) {
    let dueDateIso = expense.nextDueDate
    for (let step = 0; step < MAX_EXPENSE_OCCURRENCE_STEPS; step++) {
      const dueDate = new Date(`${dueDateIso}T00:00:00.000Z`)
      if (dueDate > to) break
      if (dueDate >= from) {
        occurrences.push({
          eventId: `expense-${expense.id}`,
          kind: 'expense',
          source: 'manual',
          title: tr('errors.calendar.paymentTitle', { description: expense.description }),
          description: null,
          location: null,
          allDay: true,
          color: EXPENSE_COLOR,
          isRecurring: true,
          recurrenceRule: null,
          recurrenceEndAt: null,
          occurrenceStart: dueDate.toISOString(),
          occurrenceEnd: dueDate.toISOString(),
          occurrenceKey: null,
          isException: false,
          seriesStart: dueDate.toISOString(),
          seriesEnd: dueDate.toISOString(),
          reminderMinutesBefore: null,
          reminders: [],
          // Cheltuialele recurente n-au calendar: sunt ale firmei, nu ale unui om, deci nu
          // poartă nume de proprietar și nu sunt editabile din Calendar (vezi CalendarPage.tsx).
          ownerUserId: null,
          ownerName: null,
          attendees: [],
          isCommon: false,
          access: null,
        })
      }
      dueDateIso = computeNextOccurrence(
        { cycle: expense.cycle as BillingCycle, day: expense.cycleDay, month: expense.cycleMonth },
        dayAfter(dueDateIso),
      )
    }
  }
  return occurrences
}

/** The exceptions of the given series, in one query. */
export async function loadExceptions(eventIds: string[]): Promise<ExceptionRow[]> {
  if (eventIds.length === 0) return []
  const rows = await db
    .select({
      eventId: calendarEventExceptions.eventId,
      occurrenceStart: calendarEventExceptions.occurrenceStart,
      kind: calendarEventExceptions.kind,
      startAt: calendarEventExceptions.startAt,
      endAt: calendarEventExceptions.endAt,
      overrides: calendarEventExceptions.overrides,
    })
    .from(calendarEventExceptions)
    .where(and(inArray(calendarEventExceptions.eventId, eventIds), isNull(calendarEventExceptions.deletedAt)))
  return rows
}

async function expandRows(rows: (CalendarEventRow & Partial<OccurrenceMeta>)[], from: Date, to: Date): Promise<Occurrence[]> {
  const timeZone = await getCompanyTimeZone()
  const exceptions = await loadExceptions(rows.filter((row) => row.recurrenceRule).map((row) => row.id))
  return rows.flatMap((row) => expandOccurrence(row, from, to, timeZone, exceptions))
}

/** Condiția de fereastră pe rândurile de evenimente — unicul loc unde se calculează, ca
 *  filtrarea pe owner și cea pe dată să nu se desincronizeze. */
// Coloanele sunt calificate cu alias-ul `e`, nu cu numele tabelei: interogările de mai jos
// folosesc `FROM "calendar_events" e`, iar `calendarEvents.startAt` s-ar califica ca
// "calendar_events"."start_at" — invalid într-un SELECT pe alias (verificat: Postgres 42P01).
function inWindow(from: Date, to: Date) {
  // ISO + cast explicit: într-un `sql` crud parametrii nu trec prin maparea de coloane a lui
  // Drizzle, deci un `Date` ar ajunge la driver ca obiect și postgres-js ar arunca la bind.
  const fromIso = from.toISOString()
  const toIso = to.toISOString()
  return sql`(
    e."start_at" <= ${toIso}::timestamptz
    AND (
      (e."recurrence_rule" IS NULL AND e."end_at" >= ${fromIso}::timestamptz)
      OR (e."recurrence_rule" IS NOT NULL AND (e."recurrence_end_at" IS NULL OR e."recurrence_end_at" >= ${fromIso}::timestamptz))
    )
  )`
}

/**
 * Ocurențele pe care omul le vede: calendarul lui, calendarele partajate cu el, evenimentele
 * comune de care e participant, plus — pentru cine are `calendar.administrare` — toate.
 * `visibility` vine din modules/calendar/service.ts (unde stă regulile de acces), ca acest
 * fișier, folosit și de joburi, să nu depindă de modul.
 */
export async function listOccurrences(
  from: Date,
  to: Date,
  visibility: { me: SessionUser; condition: SQL },
): Promise<Occurrence[]> {
  const rows = await db.execute<CalendarEventRow & OccurrenceMeta>(sql`
    SELECT e."id",
           e."created_at" AS "createdAt",
           e."updated_at" AS "updatedAt",
           e."deleted_at" AS "deletedAt",
           e."created_by_user_id" AS "createdByUserId",
           e."updated_by_user_id" AS "updatedByUserId",
           e."owner_user_id" AS "ownerUserId",
           e."title", e."description", e."location",
           e."start_at" AS "startAt", e."end_at" AS "endAt",
           e."all_day" AS "allDay", e."recurrence_rule" AS "recurrenceRule",
           e."recurrence_end_at" AS "recurrenceEndAt", e."color",
           e."source",
           COALESCE(NULLIF(u."display_name", ''), u."email") AS "ownerName",
           COALESCE((
             SELECT json_agg(json_build_object('id', u2."id", 'name', COALESCE(NULLIF(u2."display_name", ''), u2."email")) ORDER BY u2."display_name")
               FROM "calendar_event_attendees" ca
               JOIN "users" u2 ON u2."id" = ca."user_id"
              WHERE ca."event_id" = e."id" AND ca."deleted_at" IS NULL AND ca."user_id" <> e."owner_user_id"
           ), '[]'::json) AS attendees,
           COALESCE((
             SELECT json_agg(r."minutes_before" ORDER BY r."minutes_before")
               FROM "calendar_event_reminders" r
              WHERE r."event_id" = e."id" AND r."deleted_at" IS NULL
           ), '[]'::json) AS reminders,
           CASE
             WHEN e."owner_user_id" = ${visibility.me.id} THEN 'owner'
             WHEN EXISTS (SELECT 1 FROM "calendar_shares" cs
                           WHERE cs."owner_user_id" = e."owner_user_id" AND cs."user_id" = ${visibility.me.id}
                             AND cs."level" = 'edit' AND cs."deleted_at" IS NULL) THEN 'edit'
             WHEN ${visibility.me.features.includes('calendar.comune')} AND EXISTS (
                    SELECT 1 FROM "calendar_event_attendees" ca2
                     WHERE ca2."event_id" = e."id" AND ca2."user_id" = ${visibility.me.id} AND ca2."deleted_at" IS NULL
                 ) THEN 'edit'
             ELSE 'view'
           END AS access
      FROM "calendar_events" e
      JOIN "users" u ON u."id" = e."owner_user_id"
     WHERE e."deleted_at" IS NULL AND ${inWindow(from, to)} AND ${visibility.condition}
  `)

  const eventOccurrences = await expandRows(rows.map(hydrate), from, to)
  // Recurring payments are the company's money: only people who can see expenses get them.
  const expenseOccurrences = visibility.me.features.includes('facturi.cheltuieli') ? await listRecurringExpenseOccurrences(from, to) : []

  return [...eventOccurrences, ...expenseOccurrences].sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart))
}

/**
 * Ocurențele unui singur calendar, fără perspectiva de om — pt. programările publice de pe
 * site: sloturile libere se calculează doar din calendarul lui Stefan, iar un eveniment comun
 * la care e participant îl face ocupat (decizie Stefan, 2026-09-30).
 */
export async function listOccurrencesForOwner(ownerUserId: string, from: Date, to: Date): Promise<Occurrence[]> {
  const rows = await db.execute<CalendarEventRow & OccurrenceMeta>(sql`
    SELECT e."id",
           e."created_at" AS "createdAt",
           e."updated_at" AS "updatedAt",
           e."deleted_at" AS "deletedAt",
           e."created_by_user_id" AS "createdByUserId",
           e."updated_by_user_id" AS "updatedByUserId",
           e."owner_user_id" AS "ownerUserId",
           e."title", e."description", e."location",
           e."start_at" AS "startAt", e."end_at" AS "endAt",
           e."all_day" AS "allDay", e."recurrence_rule" AS "recurrenceRule",
           e."recurrence_end_at" AS "recurrenceEndAt", e."color",
           e."source",
           COALESCE(NULLIF(u."display_name", ''), u."email") AS "ownerName",
           '[]'::json AS attendees
      FROM "calendar_events" e
      JOIN "users" u ON u."id" = e."owner_user_id"
     WHERE e."deleted_at" IS NULL AND ${inWindow(from, to)}
       AND (
         e."owner_user_id" = ${ownerUserId}
         OR EXISTS (SELECT 1 FROM "calendar_event_attendees" ca
                     WHERE ca."event_id" = e."id" AND ca."user_id" = ${ownerUserId} AND ca."deleted_at" IS NULL)
       )
  `)

  const eventOccurrences = await expandRows(rows.map(hydrate), from, to)
  const expenseOccurrences = await listRecurringExpenseOccurrences(from, to)
  return [...eventOccurrences, ...expenseOccurrences].sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart))
}
