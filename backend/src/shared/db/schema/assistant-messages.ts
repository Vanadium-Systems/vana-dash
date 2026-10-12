import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { assistantConversations } from './assistant-conversations.js'

// content: array de content blocks Anthropic (text / tool_use / tool_result) — persistat 1:1
// ca să poată fi retrimis direct în `messages` la reluarea conversației (Tool Runner).
// input/output tokens: usage-ul raportat de provider pt. rândul respectiv (null la rândurile
// vechi) — alimentează meter-ul de context din UI (sprint 2026-08-26).
export const assistantMessages = pgTable(
  'assistant_messages',
  {
    ...standardColumns,
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: jsonb('content').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
  },
  (t) => [index('idx_assistant_messages_conversation').on(t.conversationId, t.createdAt)],
)

