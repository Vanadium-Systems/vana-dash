import { sql } from 'drizzle-orm'
import { check, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { emailTemplates } from './email-templates.js'
import { emailThreads } from './email-threads.js'
import { emailMessages } from './email-messages.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Draft-uri de compose — tabelă proprie, nu un rând special în email_messages (un draft nu s-a
// "întâmplat" încă, n-are resendEmailId, nu trece prin Resend deloc până se trimite).
// attachments: array {filename, storagePath} — fișierul e deja pe disc via saveDocument la
// upload, nu base64 în DB.
export const emailDrafts = pgTable(
  'email_drafts',
  {
  ...tenantColumns,
  ...standardColumns,
  // Ciornele sunt ale autorului, nu ale cutiei: o ciornă pe sales@ nu apare colegului care are
  // aceeași cutie (decizie Stefan, 2026-09-28).
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  // Cheia unei identități din Setări Email (dinamice), deci fără enum.
  fromKey: text('from_key').notNull(),
  to: text('to').notNull().default(''),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  templateId: uuid('template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
  attachments: jsonb('attachments').notNull().default([]),
  // Reply and forward drafts live under the thread they answer; 'new' drafts have no thread.
  mode: text('mode', { enum: ['new', 'reply', 'reply_all', 'forward'] }).notNull().default('new'),
  threadId: uuid('thread_id').references(() => emailThreads.id, { onDelete: 'cascade' }),
  sourceMessageId: uuid('source_message_id').references(() => emailMessages.id, { onDelete: 'set null' }),
  cc: text('cc').notNull().default(''),
  },
  (t) => [
    check('ck_email_drafts_mode', sql`${t.mode} IN ('new', 'reply', 'reply_all', 'forward')`),
    // One reply draft per thread per person, so reopening the thread finds it.
    uniqueIndex('uq_email_drafts_reply')
      .on(t.tenantId, t.ownerUserId, t.threadId, t.mode)
      .where(sql`${t.threadId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
)
