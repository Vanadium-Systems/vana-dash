import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { calendarEvents } from './calendar-events.js'
import { standardColumns } from './helpers.js'

// Programări publice de pe vanadium.systems (docs/BOOKING.md). Orele de lucru stau în
// dashboard_config['booking.settings']; aici doar intervalele blocate și rezervările.

export const bookingBlocks = pgTable(
  'booking_blocks',
  {
    ...standardColumns,
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
  },
  (t) => [index('idx_booking_blocks_range').on(t.startAt, t.endAt)],
)

// Datele vizitatorului stau aici, nu în calendar, ca purjarea la 90 de zile (jobs/booking-purge.ts)
// să nu atingă calendarul. După purjare rămân doar ora și statusul.
export const bookings = pgTable(
  'bookings',
  {
    ...standardColumns,
    calendarEventId: uuid('calendar_event_id').references(() => calendarEvents.id),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    name: text('name'),
    email: text('email'),
    company: text('company'),
    topic: text('topic'),
    // The language of the site page the visitor booked from ('ro', 'en', 'fr'...). Picks the
    // language of the emails and the cancel page they link to.
    locale: text('locale'),
    status: text('status').notNull().default('confirmed'),
    // Momentul în care formularul a afișat informarea (nu un acord: temeiul e art. 6(1)(b)).
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    cancelTokenHash: text('cancel_token_hash'),
    personalDataPurgedAt: timestamp('personal_data_purged_at', { withTimezone: true }),
  },
  (t) => [
    // Ultima apărare contra dublei rezervări: două tranzacții simultane pe același slot, una pică aici.
    uniqueIndex('uq_bookings_confirmed_start').on(t.startAt).where(sql`status = 'confirmed' AND deleted_at IS NULL`),
    uniqueIndex('uq_bookings_cancel_token').on(t.cancelTokenHash),
    index('idx_bookings_end').on(t.endAt),
  ],
)
