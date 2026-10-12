import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { bankAccounts } from './bank-accounts.js'

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    ...standardColumns,
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    // Id-ul tranzacției la provider — target-ul de upsert (sync-ul e idempotent).
    externalId: text('external_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    counterpartyName: text('counterparty_name'),
    counterpartyIban: text('counterparty_iban'),
    reference: text('reference'),
    valueDate: timestamp('value_date', { withTimezone: true }).notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    rawMeta: jsonb('raw_meta'),
  },
  (t) => [
    uniqueIndex('uq_bank_transactions_external').on(t.bankAccountId, t.externalId),
    index('ix_bank_transactions_value_date').on(t.bankAccountId, t.valueDate),
  ],
)
