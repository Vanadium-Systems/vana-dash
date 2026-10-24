import { boolean, jsonb, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { SpvNotificationItem } from '../../../connectors/anaf/spv-notifications.js'
import { emailMessages } from './email-messages.js'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// One row per ANAF email (SPV "Documente noi SPV", form 150 answers) read by
// jobs/spv-notifications.ts: what it contained and whether it needed attention. The row is
// also the marker that the email was handled, so the job never alerts twice.
export const spvEmailNotices = pgTable(
  'spv_email_notices',
  {
    ...tenantColumns,
    ...standardColumns,
    emailMessageId: uuid('email_message_id')
      .notNull()
      .references(() => emailMessages.id, { onDelete: 'cascade' }),
    items: jsonb('items').$type<SpvNotificationItem[]>().notNull(),
    important: boolean('important').notNull(),
  },
  (t) => [uniqueIndex('uq_spv_email_notices_message').on(t.emailMessageId)],
)
