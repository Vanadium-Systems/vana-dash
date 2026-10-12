import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { archiveFolders } from './archive-folders.js'
import { users } from './users.js'

// Share pe folder, pe două niveluri (PLAN.md C2): `view` (vede conținutul) și `edit`
// (încarcă, mută, șterge). Dreptul se moștenește în subarbore, deci un rând aici e suficient
// pentru tot ce e mai jos. Share-ul îl dă doar proprietarul folderului sau adminul — cine are
// doar `edit` lucrează în folder, nu îl dă mai departe (verificat în service, nu aici).
export const archiveFolderShares = pgTable(
  'archive_folder_shares',
  {
    ...standardColumns,
    folderId: uuid('folder_id')
      .notNull()
      .references(() => archiveFolders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: text('level', { enum: ['view', 'edit'] }).notNull().default('view'),
  },
  (t) => [
    // O persoană, un singur nivel pe folder — schimbarea nivelului face UPDATE, nu al doilea rând.
    uniqueIndex('uq_archive_folder_shares_folder_user').on(t.folderId, t.userId),
    index('idx_archive_folder_shares_user').on(t.userId),
  ],
)