import { pgTable, text } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Template-uri reutilizate la compose 1:1 și la bulk send.
// {{nume}} în body e înlocuit la trimitere (nu la salvare).
export const emailTemplates = pgTable('email_templates', {
  ...tenantColumns,
  ...standardColumns,
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
})
