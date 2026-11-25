import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { billingClients } from './billing-clients.js'
import { bookings } from './booking.js'
import { conversations } from './chat.js'
import { standardColumns } from './helpers.js'
import { prospects } from './prospects.js'
import { tenantColumns } from './tenant-column.js'
import { users } from './users.js'

// Video and audio calls (LiveKit E2EE). Daily was removed: provider 'daily' stays valid in the enum
// and the CHECK so old rows keep loading, but they have no room and are shown as ended.
// The row keeps our public link (/apel/<public_id>), the time window, optional conversation
// or prospect link, and post-call summary stats.
export const calls = pgTable(
  'calls',
  {
    ...tenantColumns,
    ...standardColumns,
    title: text('title').notNull(),
    // Random unguessable room name at the SFU provider.
    roomName: text('room_name').notNull().unique(),
    // Only old Daily rows have a value; LiveKit rooms leave it null (the SFU URL comes from livekit_settings).
    roomUrl: text('room_url'),
    // Our own link, /apel/<public_id>, so guests open our domain and never see provider URLs.
    publicId: text('public_id').notNull().unique(),
    kind: text('kind', { enum: ['audio', 'video'] }).notNull().default('video'),
    provider: text('provider', { enum: ['daily', 'livekit'] }).notNull().default('livekit'),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    // Encrypted (v1 envelope) ONLY for server-created booking calls so the host can open the
    // E2EE room from Calendar; user-created calls never send the E2EE key to the server.
    guestKeyEnc: text('guest_key_enc'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['open', 'ended', 'cancelled'] }).notNull().default('open'),
    bookingId: uuid('booking_id').references(() => bookings.id),
    prospectId: uuid('prospect_id').references(() => prospects.id),
    billingClientId: uuid('billing_client_id').references(() => billingClients.id),
    // LiveKit only says who is in a room now, so the stats are kept as the call runs: the first
    // answer, the last moment someone was seen in it, and the most people at once.
    startedAt: timestamp('started_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    participantCount: integer('participant_count'),
    roomDeletedAt: timestamp('room_deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_calls_created').on(t.createdAt.desc()),
    index('idx_calls_status_expires').on(t.status, t.expiresAt),
    index('idx_calls_conversation').on(t.conversationId).where(sql`conversation_id IS NOT NULL`),
    uniqueIndex('uq_calls_booking').on(t.bookingId).where(sql`booking_id IS NOT NULL`),
    check('ck_calls_kind', sql`${t.kind} IN ('audio', 'video')`),
    check('ck_calls_provider', sql`${t.provider} IN ('daily', 'livekit')`),
  ],
)

// Per-company LiveKit Cloud configuration, editable from Settings -> Calls.
// Secrets are encrypted with encryptField (v1 envelope) and never returned in responses.
export const livekitSettings = pgTable(
  'livekit_settings',
  {
    ...tenantColumns,
    ...standardColumns,
    url: text('url').notNull().default(''),
    apiKeyEnc: text('api_key_enc'),
    apiSecretEnc: text('api_secret_enc'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('uq_livekit_settings_tenant').on(t.tenantId)],
)
