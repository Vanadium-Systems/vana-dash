import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { emailLabels } from './email-labels.js'

// Reguli de rutare la ingest (ex: "de la contabil@x.ro → label Contabilitate"). TOATE regulile
// se evaluează la fiecare mesaj primit (ca la Gmail filters — pot aplica mai multe simultan),
// nu doar prima potrivire. `labelId` obligatoriu doar dacă action='label' (validat în Zod).
export const emailRules = pgTable('email_rules', {
  ...standardColumns,
  matchType: text('match_type', { enum: ['from_address', 'from_domain', 'subject_contains'] }).notNull(),
  matchValue: text('match_value').notNull(),
  action: text('action', { enum: ['label', 'archive', 'trash', 'spam'] }).notNull(),
  labelId: uuid('label_id').references(() => emailLabels.id, { onDelete: 'set null' }),
})
