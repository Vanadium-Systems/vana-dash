import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

export const assistantConversations = pgTable('assistant_conversations', {
  ...tenantColumns,
  ...standardColumns,
  // Rulările programate din conversație rulează cu drepturile autorului (BE-5).
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  // Null = folosește config.anthropic.model (default global). Setat per-conversație când
  // Stefan alege explicit din dropdown — permite să treacă pe un model mai ieftin (Haiku)
  // fără să schimbe default-ul global din env.
  model: text('model'),
  // Override provider per conversație ('anthropic'|'openrouter') — null = default-ul global
  // din assistant_providers / env (sprint multi-provider 2026-08-25).
  provider: text('provider'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
})
