import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { assistantConversations } from './assistant-conversations.js'
import { tenantColumns } from './tenant-column.js'

// Acțiuni din whitelist-ul "confirm" (vezi PLAN_INAPP_AGENT.md) — Claude le înregistrează aici
// în loc să le execute direct; execuția reală se întâmplă doar la POST /actions/:id/confirm.
export const assistantPendingActions = pgTable(
  'assistant_pending_actions',
  {
    ...tenantColumns,
    ...standardColumns,
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    toolInput: jsonb('tool_input').notNull(),
    toolUseId: text('tool_use_id').notNull(),
    status: text('status', { enum: ['pending', 'confirmed', 'rejected', 'expired'] })
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('idx_assistant_pending_actions_status_expires').on(t.status, t.expiresAt)],
)
