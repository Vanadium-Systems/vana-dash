import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { platforms } from './platforms.js'
import { tenantColumns } from './tenant-column.js'

export const syncLog = pgTable(
  'sync_log',
  {
    ...tenantColumns,
    ...standardColumns,
    // null pentru sync-urile non-platformă (ANAF, bănci) — vezi jobKey.
    platformId: uuid('platform_id').references(() => platforms.id, { onDelete: 'cascade' }),
    // Identifică sursa sync-ului când platformId e null: 'anaf:<cif>' | 'bank:<accountId>'.
    jobKey: text('job_key'),
    status: text('status', { enum: ['RUNNING', 'SUCCESS', 'FAILED'] }).notNull(),
    recordsSync: integer('records_sync').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('ix_sync_log_platform').on(t.platformId, t.startedAt),
    index('ix_sync_log_job_key').on(t.jobKey, t.startedAt),
  ],
)
