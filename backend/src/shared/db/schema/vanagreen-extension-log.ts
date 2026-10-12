import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { billingClients } from './billing-clients.js'

// Istoricul acțiunilor "extinde abonament vanagreen" — atât dry-run (toggle OFF, implicit) cât
// și live (toggle ON). Idempotency e ținută în recyclers_app (platform_extension_log), acest
// tabel e doar jurnal/UI pentru vana-dash.
export const vanagreenExtensionLog = pgTable(
  'vanagreen_extension_log',
  {
    ...standardColumns,
    billingClientId: uuid('billing_client_id')
      .notNull()
      .references(() => billingClients.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['dry_run', 'live'] }).notNull(),
    source: text('source', { enum: ['auto_match', 'mark_paid'] }).notNull(),
    sourceId: text('source_id').notNull(),
    months: integer('months').notNull(),
    status: text('status', { enum: ['success', 'failed'] }).notNull(),
    responseMessage: text('response_message'),
  },
  (t) => [
    index('idx_vanagreen_extension_log_billing_client').on(t.billingClientId),
    uniqueIndex('uq_vanagreen_extension_log_source').on(t.source, t.sourceId),
  ],
)
