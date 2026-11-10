import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// In-app notifications (the bell). Push stays alongside; this is where a mention lands when the
// person has no push enabled.
export const notifications = pgTable(
  'notifications',
  {
    ...tenantColumns,
    ...standardColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    url: text('url'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_notifications_user').on(t.userId, t.createdAt.desc()),
    index('idx_notifications_unread').on(t.userId).where(sql`${t.readAt} IS NULL`),
  ],
)
