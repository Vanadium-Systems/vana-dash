import { boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

export const notes = pgTable(
  'notes',
  {
    ...tenantColumns,
    ...standardColumns,
    // Notițele sunt ale fiecărui om (PLAN.md C2) — filtrul pe owner e în service (BE-6).
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
  },
  (t) => [index('ix_notes_pinned_updated').on(t.pinned, t.updatedAt)],
)
