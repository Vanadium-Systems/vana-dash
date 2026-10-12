import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { assistantConversations } from './assistant-conversations.js'
import { users } from './users.js'

// Task-uri programate din chat (PLAN.md Contract B): reminder-e și rapoarte de asistent,
// executate de jobs/scheduled-tick.ts (scan la minut pe (status, run_at)).
export const scheduledRuns = pgTable(
  'scheduled_runs',
  {
    ...standardColumns,
    // Autorul = ale cărui drepturi rulează. Recalculat la fiecare rulare (BE-5).
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['reminder', 'report'] }).notNull(),
    // Următoarea rulare — pentru recurente se reprogramază după execuție, nu se marchează done.
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    // kind=reminder — corpul notificării; kind=report — promptul rulat de asistent
    text: text('text'),
    prompt: text('prompt'),
    linkTo: text('link_to'),
    recurrence: text('recurrence', { enum: ['once', 'daily', 'weekly'] })
      .notNull()
      .default('once'),
    // Doar weekly — ziua rulării (0=duminică .. 6=sâmbătă)
    weekday: integer('weekday'),
    conversationId: uuid('conversation_id').references(() => assistantConversations.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: ['pending', 'done', 'failed', 'cancelled'] })
      .notNull()
      .default('pending'),
    lastError: text('last_error'),
  },
  (t) => [index('ix_scheduled_runs_due').on(t.status, t.runAt)],
)
