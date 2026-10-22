import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Adrese blocate manual — match la ingest → folder:'trash' direct (comportament Gmail: block
// = trash viitor, nu delete silențios). `address` normalizată lowercase la insert/compare.
export const emailBlocklist = pgTable(
  'email_blocklist',
  {
    ...tenantColumns,
    ...standardColumns,
    address: text('address').notNull(),
  },
  (t) => [uniqueIndex('uq_email_blocklist_address').on(t.tenantId, t.address)],
)
