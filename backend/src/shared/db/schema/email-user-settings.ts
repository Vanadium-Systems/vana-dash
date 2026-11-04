import { sql } from 'drizzle-orm'
import { check, integer, jsonb, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'
import { users } from './users.js'

// A person's own email settings. The outreach cap can only lower the company's cap; a signature
// here wins over the mailbox's signature when this person sends from that mailbox.
export const emailUserSettings = pgTable(
  'email_user_settings',
  {
    ...tenantColumns,
    ...standardColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    outreachDailyCap: integer('outreach_daily_cap'),
    // { "<identityKey>": "<html>" }
    signatureByMailbox: jsonb('signature_by_mailbox').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex('uq_email_user_settings').on(t.tenantId, t.userId),
    check('ck_email_user_settings_cap', sql`${t.outreachDailyCap} IS NULL OR ${t.outreachDailyCap} >= 0`),
  ],
)
