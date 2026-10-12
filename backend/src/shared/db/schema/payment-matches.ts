import { numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { bankTransactions } from './bank-transactions.js'
import { financialRecords } from './financial-records.js'

// Legătura tranzacție bancară ↔ factură. Match-urile auto rămân vizibile și
// reversibile în UI — nu marcăm nimic "paid" orb (vezi Risks în plan).
export const paymentMatches = pgTable(
  'payment_matches',
  {
    ...standardColumns,
    ...auditColumns,
    bankTransactionId: uuid('bank_transaction_id')
      .notNull()
      .references(() => bankTransactions.id, { onDelete: 'cascade' }),
    financialRecordId: uuid('financial_record_id')
      .notNull()
      .references(() => financialRecords.id, { onDelete: 'cascade' }),
    matchType: text('match_type', { enum: ['auto', 'manual'] }).notNull(),
    // Scor 0..1 — doar pentru match-urile auto; manual = 1.
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('1'),
    matchedAt: timestamp('matched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_payment_matches_txn').on(t.bankTransactionId)],
)
