import { sql } from 'drizzle-orm'
import { check, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Personal: a star is visible only to the person who set it.
export const archiveStars = pgTable(
  'archive_stars',
  {
    ...tenantColumns,
    ...standardColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemType: text('item_type', { enum: ['file', 'folder'] }).notNull(),
    itemId: uuid('item_id').notNull(),
  },
  (t) => [
    check('archive_stars_item_type', sql`${t.itemType} IN ('file','folder')`),
    uniqueIndex('uq_archive_stars').on(t.tenantId, t.userId, t.itemType, t.itemId),
  ],
)
