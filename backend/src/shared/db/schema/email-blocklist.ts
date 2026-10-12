import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Adrese blocate manual — match la ingest → folder:'trash' direct (comportament Gmail: block
// = trash viitor, nu delete silențios). `address` normalizată lowercase la insert/compare.
export const emailBlocklist = pgTable(
  'email_blocklist',
  {
    ...standardColumns,
    address: text('address').notNull(),
  },
  (t) => [uniqueIndex('uq_email_blocklist_address').on(t.address)],
)
