import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { billingClients } from './billing-clients.js'
import { platforms } from './platforms.js'
import { tenantColumns } from './tenant-column.js'

// Extinsă în sprintul Accounting Hub: vana-dash e sursă primară de adevăr pentru
// facturile EMISE (direction='out', source='generated') și agregator pentru cele
// PRIMITE prin SPV/e-Factura (direction='in', source='anaf_efactura').
export const financialRecords = pgTable(
  'financial_records',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    type: text('type', { enum: ['invoice', 'expense', 'payment'] }).notNull(),
    // in = document primit (cheltuială/factură furnizor), out = emis de Stefan
    direction: text('direction', { enum: ['in', 'out'] }).notNull().default('out'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('RON'),
    description: text('description'),
    category: text('category'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentStatus: text('payment_status', { enum: ['unpaid', 'partial', 'paid'] })
      .notNull()
      .default('unpaid'),
    // null = introdus manual, altfel platforma din care a fost importat
    platformId: uuid('platform_id').references(() => platforms.id, { onDelete: 'set null' }),
    // manual | anaf_efactura | generated | <platform type>
    source: text('source').notNull().default('manual'),
    // Facturile emise: numărul alocat din invoice_sequences la issue (ex: VAN-2026-0001).
    documentNumber: text('document_number'),
    billingClientId: uuid('billing_client_id').references(() => billingClients.id, {
      onDelete: 'set null',
    }),
    counterpartyName: text('counterparty_name'),
    counterpartyCif: text('counterparty_cif'),
    // e-Factura: id-ul mesajului descărcat (dedup la sync) / id-ul de upload + starea lui.
    anafMessageId: text('anaf_message_id').unique(),
    anafUploadId: text('anaf_upload_id'),
    anafStatus: text('anaf_status', { enum: ['draft', 'pending', 'validated', 'rejected'] }),
    xmlStoragePath: text('xml_storage_path'),
    pdfStoragePath: text('pdf_storage_path'),
    // Sprint D, Track A — taxare inversă TVA la achiziții de servicii (direction='in'). 'none' =
    // achiziție obișnuită. Flag manual la creare/editare cheltuială (modules/accounting).
    // eu_services (Hetzner etc.) → D301 secțiunea 4.1 + D390 tip='S'. non_eu_services
    // (Cloudflare R2 etc.) → D301 secțiunea 4 FĂRĂ 4.1, niciodată în D390 (confirmat din
    // schema XML reală, nu presupus — vezi PLAN.md).
    reverseChargeType: text('reverse_charge_type', { enum: ['none', 'eu_services', 'non_eu_services'] })
      .notNull()
      .default('none'),
    // ISO-2 (ex: 'DE' pt. Hetzner, 'US' pt. Cloudflare) — necesar la generarea D301/D390.
    counterpartyCountry: text('counterparty_country'),
    // Prefill 21.00 (cota standard confirmată ANAF din 01.08.2025) la bifarea reverse charge,
    // editabil — niciodată hardcodat în calculul d301-builder.
    reverseChargeVatRate: numeric('reverse_charge_vat_rate', { precision: 5, scale: 2 }),
    meta: jsonb('meta'),
  },
  (t) => [
    index('ix_financial_records_issued').on(t.type, t.issuedAt),
    index('ix_financial_records_payment').on(t.direction, t.paymentStatus),
    index('ix_financial_records_anaf_status').on(t.anafStatus),
    // O singură factură per număr alocat (partial: doar rândurile cu număr).
    uniqueIndex('uq_financial_records_doc_number').on(t.tenantId, t.documentNumber),
    index('ix_financial_records_reverse_charge').on(t.reverseChargeType, t.issuedAt),
  ],
)
