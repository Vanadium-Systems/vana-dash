import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Token-uri FCM ale APK-ului Capacitor (PLAN.md Contract C). Web-push-ul browserelor
// trăiește separat în push_subscriptions — notify() face fan-out pe ambele canale.
export const deviceTokens = pgTable(
  'device_tokens',
  {
    ...tenantColumns,
    ...standardColumns,
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform', { enum: ['android'] }).notNull().default('android'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // APK 1.6+: shows its own call screen, so an incoming call goes to it as a data-only message.
    callUi: boolean('call_ui').notNull().default(false),
  },
  (t) => [uniqueIndex('uq_device_tokens_token').on(t.token)],
)
