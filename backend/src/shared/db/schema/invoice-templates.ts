import { sql } from 'drizzle-orm'
import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { platforms } from './platforms.js'
import { tenantColumns } from './tenant-column.js'

// Template-uri de linii de factură per APLICAȚIE integrată (Sprint D, Track 3; re-scope
// 2026-07-18) — ex. "Abonament lunar", "Taxă inițiere". Un template e comun tuturor clienților
// unei platforme (2-3 template-uri per aplicație, nu unul per client) — prețul rămâne strict pe
// client (billing_clients.subscriptionPriceLei/Eur), luat live la generarea facturii dacă linia
// are priceSource: 'client_subscription' (vezi modules/invoicing/service.ts). Alese la crearea
// unei facturi noi, sau folosite direct de jobs/vanagreen-billing.ts via isDefaultForAutoInvoice.
export const invoiceTemplates = pgTable(
  'invoice_templates',
  {
    ...tenantColumns,
    ...standardColumns,
    platformId: uuid('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currency: text('currency', { enum: ['RON', 'EUR', 'USD'] }).notNull().default('RON'),
    // [{ description, quantity, priceSource, unitPrice, vatRatePct }] — validat Zod la nivel de service.
    lineItems: jsonb('line_items').notNull(),
    isDefaultForAutoInvoice: boolean('is_default_for_auto_invoice').notNull().default(false),
  },
  (table) => ({
    // Cel mult UN template default per platformă (nu per client — regula s-a mutat odată cu scopul).
    oneDefaultPerPlatform: uniqueIndex('idx_invoice_templates_one_default_per_platform')
      .on(table.platformId)
      .where(sql`${table.isDefaultForAutoInvoice} AND ${table.deletedAt} IS NULL`),
  }),
)
