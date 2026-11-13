import { sql } from 'drizzle-orm'
import { check, date, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { bankTransactions } from './bank-transactions.js'
import { financialRecords } from './financial-records.js'
import { tenantColumns } from './tenant-column.js'

// Cash received (or paid out, for received documents) against one document. The payment status
// of a record is derived from the sum of these rows, not stored independently.
export const invoicePayments = pgTable(
  'invoice_payments',
  {
    ...tenantColumns,
    ...standardColumns,
    recordId: uuid('record_id')
      .notNull()
      .references(() => financialRecords.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    paidAt: date('paid_at', { mode: 'string' }).notNull(),
    method: text('method', { enum: ['bank', 'cash', 'card', 'other'] }).notNull(),
    reference: text('reference'),
    note: text('note'),
    bankTransactionId: uuid('bank_transaction_id').references(() => bankTransactions.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
  },
  (t) => [
    index('idx_invoice_payments_record').on(t.recordId).where(sql`${t.deletedAt} IS NULL`),
    check('ck_invoice_payments_amount', sql`${t.amount} > 0`),
    check('ck_invoice_payments_method', sql`${t.method} IN ('bank','cash','card','other')`),
  ],
)
