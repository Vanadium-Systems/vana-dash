import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
    title: text('title').notNull().default(''),
    // Plain text of the note. For a `rich` note the server derives it from `body_json` on every
    // save (search, Ctrl K, message cards read this, never the JSON).
    body: text('body').notNull().default(''),
    bodyFormat: text('body_format', { enum: ['plain', 'rich'] }).notNull().default('plain'),
    bodyJson: jsonb('body_json'),
    pinned: boolean('pinned').notNull().default(false),
    // Index into the shared `--tag-1..8` palette; null = no color.
    color: smallint('color'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    index('ix_notes_pinned_updated').on(t.pinned, t.updatedAt),
    index('idx_notes_labels').using('gin', t.labels),
    index('idx_notes_owner_state').on(t.ownerUserId, t.deletedAt, t.archivedAt, t.pinned, t.updatedAt.desc()),
    check('notes_body_format', sql`${t.bodyFormat} IN ('plain','rich')`),
    check('notes_color_range', sql`${t.color} IS NULL OR ${t.color} BETWEEN 1 AND 8`),
  ],
)
