import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Ierarhie liberă de foldere pt. modulul Arhivă (înlocuire Google Drive).
//
// Spațiul per om (PLAN.md C2): folderul cu `parent_id` null E rădăcina unui spațiu, deci
// `ownerUserId` = omul căruia îi aparține. Subfolderele moștenesc proprietarul de la părinte
// la creare, deci coloana e plină pe fiecare rând — iar decizia de acces se ia pe lanțul de
// strămoși (CTE recursiv pe `parent_id`), nu pe un copil "copiat" în DB.
export const archiveFolders = pgTable(
  'archive_folders',
  {
    ...tenantColumns,
    ...standardColumns,
    name: text('name').notNull(),
    // self-referință — callback cu tip explicit, pattern Drizzle pt. FK către propriul tabel
    // (vezi email_messages.forwardOfMessageId). restrict: nu poți șterge un folder cu subfoldere.
    parentId: uuid('parent_id').references((): AnyPgColumn => archiveFolders.id, { onDelete: 'restrict' }),
    // Spațiul cui îi aparține folderul. Pe rădăcină e omul; în subarborele ei se propagă la
    // creare. Rândurile existente au backfill = Stefan (migrarea 0065).
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // jobs/archive-monthly-folders.ts — pe 1 ale lunii, creează automat un subfolder "LL-AAAA"
    // sub orice folder cu flag-ul ăsta activ (setat din UI, per folder, nu global).
    autoMonthlySubfolders: boolean('auto_monthly_subfolders').notNull().default(false),
  },
  (t) => [
    index('idx_archive_folders_parent').on(t.parentId),
    index('idx_archive_folders_owner').on(t.ownerUserId),
    // Un folder care e propriul părinte face orice CTE recursiv pe `parent_id` să nu se mai
    // termine (2026-10-01: 15 interogări au scris ~700 GB de fișiere temporare pe Postgres-ul de
    // dev). Ciclurile mai lungi le oprește `wouldCreateCycle` la mutare.
    check('archive_folders_not_own_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
)