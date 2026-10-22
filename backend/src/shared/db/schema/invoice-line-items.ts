import { integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { financialRecords } from './financial-records.js'
import { tenantColumns } from './tenant-column.js'

// Liniile facturilor emise (financial_records cu direction='out', source='generated').
export const invoiceLineItems = pgTable('invoice_line_items', {
  ...tenantColumns,
  ...standardColumns,
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => financialRecords.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('1'),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  // Cota TVA în procente (ex: 21.00). 0 = neplătitor / scutit.
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('0'),
})
