import { sql } from 'drizzle-orm'
import { boolean, index, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { recurringExpenses } from './recurring-expenses.js'
import { tenantColumns } from './tenant-column.js'
import { auditColumns } from './users.js'

// Matching rules for inbound emails containing supplier PDF invoices (e.g. Stripe/Anthropic, Hetzner).
export const supplierEmailRules = pgTable(
  'supplier_email_rules',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    /** Exact email address ('invoice+statements@mail.anthropic.com') or domain ('@hetzner.com'), lowercase. */
    senderPattern: text('sender_pattern').notNull(),
    /** Optional case-insensitive substring in the email subject. */
    subjectContains: text('subject_contains'),
    /** Optional case-insensitive substring on the PDF attachment filename (e.g. 'invoice' to skip 'Receipt-*.pdf'). */
    attachmentNamePattern: text('attachment_name_pattern'),
    counterpartyName: text('counterparty_name').notNull(),
    counterpartyCif: text('counterparty_cif'),
    counterpartyCountry: text('counterparty_country'),
    currency: text('currency').notNull().default('EUR'),
    category: text('category'),
    reverseChargeType: text('reverse_charge_type', { enum: ['none', 'eu_services', 'non_eu_services'] })
      .notNull()
      .default('none'),
    reverseChargeVatRate: numeric('reverse_charge_vat_rate', { precision: 5, scale: 2 }),
    recurringExpenseId: uuid('recurring_expense_id').references(() => recurringExpenses.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('uq_supplier_email_rules_sender')
      .on(t.tenantId, sql`lower(${t.senderPattern})`, sql`coalesce(lower(${t.attachmentNamePattern}), '')`)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_supplier_email_rules_active').on(t.tenantId, t.active).where(sql`${t.deletedAt} IS NULL`),
  ],
)
