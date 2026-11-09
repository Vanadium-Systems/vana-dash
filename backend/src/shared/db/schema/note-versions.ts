import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { notes } from './notes.js'
import { tenantColumns } from './tenant-column.js'

// The state of a note before a save, written at most once per 10 minutes, 50 kept per note
// (modules/notes/versions.ts).
export const noteVersions = pgTable(
  'note_versions',
  {
    ...tenantColumns,
    ...standardColumns,
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    bodyJson: jsonb('body_json'),
  },
  (t) => [index('idx_note_versions_note').on(t.noteId, t.createdAt.desc())],
)
