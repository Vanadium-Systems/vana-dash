import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'
import { auditColumns, users } from './users.js'

// Tracks when an accounting month ('YYYY-MM') was marked as complete by a team member.
export const accountingMonthClosures = pgTable(
  'accounting_month_closures',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    period: text('period').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('uq_accounting_month_closures_period')
      .on(t.tenantId, t.period)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
)
