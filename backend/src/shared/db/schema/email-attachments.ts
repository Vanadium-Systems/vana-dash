import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { emailMessages } from './email-messages.js'
import { tenantColumns } from './tenant-column.js'

// Atașamente descărcate de la Resend, stocate local (pattern identic cu documents din Accounting).
export const emailAttachments = pgTable('email_attachments', {
  ...tenantColumns,
  ...standardColumns,
  messageId: uuid('message_id')
    .notNull()
    .references(() => emailMessages.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  storagePath: text('storage_path').notNull(),
  contentType: text('content_type'),
  // Sprint 3 (2026-07-24) — leagă <img src="cid:X"> din bodyHtml de atașamentul inline
  // corespunzător. Content-ID header (fără <>). Enum-ul 'disposition' e doar TS (text simplu în
  // DB, pattern identic inboundSource) — 'inline' | 'attachment' | null (necunoscut, mesaje vechi).
  contentId: text('content_id'),
  disposition: text('disposition'),
})
