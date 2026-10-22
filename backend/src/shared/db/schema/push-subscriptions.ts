import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Un device poate re-subscrie la reinstall/telefon nou — endpoint-ul e unic per subscripție
// browser, folosit ca cheie de upsert la POST /api/push/subscribe.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    ...tenantColumns,
    ...standardColumns,
    // Push-ul ajunge doar pe device-urile omului, nu pe toate (BE-6).
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dhKey: text('p256dh_key').notNull(),
    authKey: text('auth_key').notNull(),
    deviceLabel: text('device_label'),
  },
  (t) => [uniqueIndex('idx_push_subscriptions_endpoint').on(t.endpoint)],
)
