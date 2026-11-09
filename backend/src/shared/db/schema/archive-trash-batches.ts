import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// One row per delete action in the Archive. The deleted rows keep their place in the tree and carry
// `deleted_batch_id`; restoring the batch clears it, purging it removes the rows and the R2 objects
// (jobs/trash-purge.ts). `deleted_at` here = the batch left the Trash (restored or purged).
export const archiveTrashBatches = pgTable(
  'archive_trash_batches',
  {
    ...tenantColumns,
    ...standardColumns,
    rootType: text('root_type', { enum: ['file', 'folder'] }).notNull(),
    rootId: uuid('root_id').notNull(),
    // The folder the root was deleted from. Trash visibility is computed on it: the deleted subtree
    // itself is outside every access CTE.
    originalParentId: uuid('original_parent_id').notNull(),
    deletedByUserId: uuid('deleted_by_user_id')
      .notNull()
      .references(() => users.id),
    itemCount: integer('item_count').notNull(),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
    purgeAfter: timestamp('purge_after', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('archive_trash_batches_root_type', sql`${t.rootType} IN ('file','folder')`),
    index('idx_archive_trash_purge').on(t.purgeAfter).where(sql`${t.deletedAt} IS NULL`),
  ],
)
