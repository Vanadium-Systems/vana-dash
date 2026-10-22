import { integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Numerotarea facturilor emise — pattern identic cu document_sequences din vanagreen,
// dar fără tenant și fără linking (o singură serie e suficientă; extensibil prin `key`).
// Alocarea se face cu SELECT ... FOR UPDATE într-o tranzacție (shared/lib/sequences.ts).
export const invoiceSequences = pgTable('invoice_sequences', {
  ...tenantColumns,
  ...standardColumns,
  key: text('key').notNull().default('invoice'),
  prefix: text('prefix').notNull().default('VAN'),
  separator: text('separator').notNull().default('-'),
  yearFormat: text('year_format', { enum: ['none', 'yy', 'yyyy'] })
    .notNull()
    .default('none'),
  padding: integer('padding').notNull().default(4),
  startFrom: integer('start_from').notNull().default(1),
  resetOn: text('reset_on', { enum: ['never', 'year'] }).notNull().default('never'),
  currentValue: integer('current_value').notNull().default(0),
  lastResetYear: integer('last_reset_year'),
  // Default payment term, in calendar days from the issue date. createDraftInvoice falls back
  // to it when the client has no `paymentTermsDays` of its own (billing-clients.ts) and the
  // invoice comes without an explicit dueAt. 10 matches the standard contract; a client with an
  // older or separately negotiated contract (15 days, say) needs the per-client exception.
  defaultPaymentTermsDays: integer('default_payment_terms_days').notNull().default(10),
}, (t) => [uniqueIndex('uq_invoice_sequences_tenant_key').on(t.tenantId, t.key)])
