import { sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns, users } from './users.js'
import { billingClients } from './billing-clients.js'
import { prospects } from './prospects.js'
import { tenantColumns } from './tenant-column.js'

export const CONTRACT_STATUSES = ['draft', 'to_sign', 'signed', 'expired', 'terminated'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]
export const CONTRACT_COUNTERPARTY_KINDS = ['client', 'prospect', 'user', 'other'] as const
export const CONTRACT_ORIGINS = ['saas', 'template', 'uploaded'] as const

export const contractSeries = pgTable(
  'contract_series',
  {
    ...tenantColumns,
    ...standardColumns,
    code: text('code').notNull(),
    name: text('name').notNull(),
    // {code} and {n:3} (number padded to 3 digits) are the only tokens.
    numberFormat: text('number_format').notNull().default('{code}-{n:3}'),
  },
  (t) => [uniqueIndex('uq_contract_series_tenant_code').on(t.tenantId, t.code).where(sql`${t.deletedAt} IS NULL`)],
)

export const contracts = pgTable(
  'contracts',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    title: text('title').notNull(),
    category: text('category').notNull(),
    counterpartyKind: text('counterparty_kind', { enum: CONTRACT_COUNTERPARTY_KINDS }).notNull(),
    billingClientId: uuid('billing_client_id').references(() => billingClients.id),
    prospectId: uuid('prospect_id').references(() => prospects.id),
    userId: uuid('user_id').references(() => users.id),
    counterpartyName: text('counterparty_name').notNull(),
    seriesId: uuid('series_id').references(() => contractSeries.id),
    number: integer('number'),
    // A number we do not own: the other company's, or one lost to a conflict in the backfill.
    externalNumber: text('external_number'),
    signedOn: date('signed_on'),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    autoRenew: boolean('auto_renew').notNull().default(false),
    renewalMonths: integer('renewal_months'),
    noticeDays: integer('notice_days'),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: CONTRACT_STATUSES }).notNull().default('draft'),
    origin: text('origin', { enum: CONTRACT_ORIGINS }).notNull(),
    templateId: uuid('template_id'),
    // The template as it was when the document was made, so editing the template later does not change it.
    templateSnapshot: jsonb('template_snapshot'),
    fieldValues: jsonb('field_values').$type<Record<string, unknown>>().notNull().default({}),
    noticeEventId: uuid('notice_event_id'),
    // The ends_on the notice alert was raised for: one alert per term, again after a renewal.
    noticeAlertedFor: date('notice_alerted_for'),
  },
  (t) => [
    index('idx_contracts_tenant_ends_on').on(t.tenantId, t.endsOn).where(sql`${t.deletedAt} IS NULL`),
    index('idx_contracts_billing_client').on(t.billingClientId),
    check('contracts_renewal_months', sql`NOT ${t.autoRenew} OR ${t.renewalMonths} > 0`),
    check('contracts_notice_needs_end', sql`${t.noticeDays} IS NULL OR ${t.endsOn} IS NOT NULL`),
  ],
)

export const contractNumbers = pgTable(
  'contract_numbers',
  {
    ...tenantColumns,
    ...standardColumns,
    seriesId: uuid('series_id')
      .notNull()
      .references(() => contractSeries.id),
    number: integer('number').notNull(),
    kind: text('kind', { enum: ['used', 'reserved'] }).notNull(),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'cascade' }),
    note: text('note'),
  },
  // The only thing that guarantees a number is never handed out twice; rows are deleted, never soft-deleted.
  (t) => [uniqueIndex('uq_contract_numbers_tenant_series_number').on(t.tenantId, t.seriesId, t.number)],
)
