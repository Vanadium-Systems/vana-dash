import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { billingClients } from './billing-clients.js'
import { bookings } from './booking.js'
import { standardColumns } from './helpers.js'
import { prospects } from './prospects.js'

// Video calls (Daily Prebuilt). The room lives at Daily; this row keeps the link we send,
// the time window and, after the call, how long it lasted.
export const calls = pgTable(
  'calls',
  {
    ...standardColumns,
    title: text('title').notNull(),
    // Daily room name, 24 random characters: the room is public, the name is the lock.
    roomName: text('room_name').notNull().unique(),
    roomUrl: text('room_url').notNull(),
    // Our own link, /apel/<public_id>, so people get our domain and our texts, not daily.co.
    publicId: text('public_id').notNull().unique(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['open', 'ended', 'cancelled'] }).notNull().default('open'),
    bookingId: uuid('booking_id').references(() => bookings.id),
    prospectId: uuid('prospect_id').references(() => prospects.id),
    billingClientId: uuid('billing_client_id').references(() => billingClients.id),
    durationSeconds: integer('duration_seconds'),
    participantCount: integer('participant_count'),
    roomDeletedAt: timestamp('room_deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_calls_created').on(t.createdAt.desc()),
    index('idx_calls_status_expires').on(t.status, t.expiresAt),
    uniqueIndex('uq_calls_booking').on(t.bookingId).where(sql`booking_id IS NOT NULL`),
  ],
)
