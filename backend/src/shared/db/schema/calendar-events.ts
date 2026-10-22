import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Orar recurent + evenimente ad-hoc într-un singur tabel — recurrenceRule null = eveniment
// unic, altfel RRULE (iCal) expandat server-side (modules/calendar/service.ts, lib. `rrule`).
// Editare/ștergere afectează întreaga serie în MVP — nicio excepție per-ocurență (vezi PLAN.md).
//
// Calendar per om (PLAN.md C2): fiecare eveniment are un singur proprietar, deci calendarul
// lui e o simplă listă de evenimente ale lui + share pe calendar (calendar_shares) + evenimente
// comune (calendar_event_attendees). Rândurile existente au backfill = Stefan (migrarea 0065).
export const calendarEvents = pgTable(
  'calendar_events',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    recurrenceRule: text('recurrence_rule'),
    recurrenceEndAt: timestamp('recurrence_end_at', { withTimezone: true }),
    color: text('color'),
    // null = fără reminder. Dedup pe ocurență (nu boolean) — un eveniment recurent trebuie să
    // notifice la FIECARE apariție, nu o singură dată vreodată (vezi jobs/calendar-reminders.ts).
    reminderMinutesBefore: integer('reminder_minutes_before'),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    // 'manual' | 'booking' — evenimentele create de o rezervare de pe site (modules/booking).
    source: text('source').notNull().default('manual'),
  },
  (t) => [
    index('idx_calendar_events_start').on(t.startAt),
    // Lista calendarului e mereu „evenimentele mele din fereastra asta" — coloana de după care
    // se filtrează mereu, deci indexul e pe (owner, start), nu doar pe start.
    index('idx_calendar_events_owner_start').on(t.ownerUserId, t.startAt),
  ],
)

/** Share pe calendarul întreg al unui om, pe două niveluri (vezi `archive_folder_shares`).
 *  Cazul de pornire: un secretar primește „editează" pe calendarul lui Stefan. */
export const calendarShares = pgTable(
  'calendar_shares',
  {
    ...tenantColumns,
    ...standardColumns,
    // Cui îi aparține calendarul (owner_user_id), nu evenimentul.
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: text('level', { enum: ['view', 'edit'] }).notNull().default('view'),
  },
  (t) => [
    uniqueIndex('uq_calendar_shares_owner_user').on(t.ownerUserId, t.userId),
    index('idx_calendar_shares_user').on(t.userId),
  ],
)

/** Participanții unui eveniment comun — apare în calendarul fiecăruia, fără share între
 *  calendare. Crearea/edarea/ștergerea e doar cu `calendar.comune` (service, nu aici). */
export const calendarEventAttendees = pgTable(
  'calendar_event_attendees',
  {
    ...tenantColumns,
    ...standardColumns,
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('uq_calendar_event_attendees_event_user').on(t.eventId, t.userId),
    index('idx_calendar_event_attendees_user').on(t.userId),
  ],
)