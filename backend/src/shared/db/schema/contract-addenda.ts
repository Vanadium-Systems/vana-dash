import { sql } from 'drizzle-orm'
import { boolean, date, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { billingClients } from './billing-clients.js'
import { tenantColumns } from './tenant-column.js'

// Contract addenda, as a structured history per client. `number` runs per client (1, 2, 3…),
// not globally, and is computed on the server (MAX(number)+1 in a transaction).
export const contractAddenda = pgTable(
  'contract_addenda',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    billingClientId: uuid('billing_client_id')
      .notNull()
      .references(() => billingClients.id),
    number: integer('number').notNull(),
    issuedAt: date('issued_at', { mode: 'string' }).notNull(),
    oldPriceNote: text('old_price_note').notNull(),
    newPriceNote: text('new_price_note').notNull(),
    reason: text('reason').notNull(),
    effectiveDateNote: text('effective_date_note').notNull(),
    temporary: boolean('temporary').notNull().default(false),
    reversionNote: text('reversion_note'),
  },
  (t) => [
    uniqueIndex('idx_contract_addenda_client_number')
      .on(t.billingClientId, t.number)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
)

export type ContractAddendum = typeof contractAddenda.$inferSelect
