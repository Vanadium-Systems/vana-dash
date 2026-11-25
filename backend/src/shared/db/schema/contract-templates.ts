import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// The company's contract templates: HTML with {{tokens}}, its own fields, a number series and the
// signing roles. Every one is written by the company; none ship with the app.
export const contractTemplates = pgTable('contract_templates', {
  ...tenantColumns,
  ...standardColumns,
  name: text('name').notNull(),
  bodyHtml: text('body_html').notNull(),
  category: text('category'),
  fields: jsonb('fields').notNull().default([]),
  seriesId: uuid('series_id'),
  signerRoles: jsonb('signer_roles').notNull().default([]),
})
