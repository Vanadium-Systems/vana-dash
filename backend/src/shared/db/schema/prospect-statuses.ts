import { sql } from 'drizzle-orm'
import { boolean, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Catalog de statusuri prospect editabil din UI (Wave 0, sprint de-hardcodare) — înlocuiește
// STATUS_OPTIONS/STATUS_LABELS/STATUS_COLORS hardcodate în ProspectareTab.tsx. `colorToken` e
// un token dintr-o paletă fixă (vezi COLOR_TOKEN_CLASSES în frontend), NU hex liber — clasele
// Tailwind complete trebuie să existe static în sursă pt. JIT purge, un token liber ar produce
// clase inexistente la build.
export const prospectStatuses = pgTable(
  'prospect_statuses',
  {
    ...standardColumns,
    key: text('key').notNull(),
    label: text('label').notNull(),
    colorToken: text('color_token').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
  },
  // Parțial (nu pe toate rândurile): un status șters (soft-delete) eliberează `key`-ul,
  // ca să poată fi recreat — la fel ca `idx_prospects_cif` (pattern existent).
  (t) => [uniqueIndex('uq_prospect_statuses_key').on(t.key).where(sql`${t.deletedAt} IS NULL`)],
)
