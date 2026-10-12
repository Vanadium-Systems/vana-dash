import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { emailThreads } from './email-threads.js'

// Citit/necitit per om, nu per cutie (decizie Stefan, 2026-09-28): aceeași cutie poate fi la
// doi oameni, iar unul care citește nu îl marchează citit și celuilalt. `last_read_at` e
// timestamp, nu boolean — necititele = mesaje primite după el. Coloana `is_read` din
// email_messages rămâne încă (migrare ulterioară, după ce BE-4 nu o mai citește).
export const emailThreadReads = pgTable(
  'email_thread_reads',
  {
    ...standardColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => emailThreads.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_email_thread_reads_user_thread').on(t.userId, t.threadId)],
)

// Consumul de token al asistentului, pe lună calendaristică (PLAN.md C2): plafonul lunar per
// om se calculează din suma acestor rânduri. `month` = 'YYYY-MM' (text, nu date — cheie de
// bucket, fără fus orar de luat în calcul).
export const assistantUsage = pgTable(
  'assistant_usage',
  {
    ...standardColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_assistant_usage_user_month').on(t.userId, t.month),
    index('ix_assistant_usage_month').on(t.month),
  ],
)
