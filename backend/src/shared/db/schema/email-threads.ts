import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Grupare mesaje (inbound + reply-uri outbound legate de un thread).
export const emailThreads = pgTable('email_threads', {
  ...standardColumns,
  subject: text('subject').notNull(),
  // adrese distincte văzute în thread
  participants: text('participants').array().notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
})
