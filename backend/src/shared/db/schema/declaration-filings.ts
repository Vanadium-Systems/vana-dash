import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'
import { auditColumns } from './users.js'

// A D301/D390 filed in SPV, with the index ANAF shows after the upload. There is no upload API,
// so the person types the index in, or jobs/spv-notifications.ts fills it from the SPV receipt
// email; a period with a filing stops the deadline alert.
export const declarationFilings = pgTable(
  'declaration_filings',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    code: text('code', { enum: ['D301', 'D390'] }).notNull(),
    /** YYYY-MM, the month the declaration reports on. */
    period: text('period').notNull(),
    anafIndex: text('anaf_index').notNull(),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the SPV receipt (INTERNT-…) for this index arrives; null = no receipt yet. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('uq_declaration_filings_period').on(t.tenantId, t.code, t.period)],
)
