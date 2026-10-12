import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'

// Token-uri FCM ale APK-ului Capacitor (PLAN.md Contract C). Web-push-ul browserelor
// trăiește separat în push_subscriptions — notify() face fan-out pe ambele canale.
export const deviceTokens = pgTable(
  'device_tokens',
  {
    ...standardColumns,
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform', { enum: ['android'] }).notNull().default('android'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_device_tokens_token').on(t.token)],
)
