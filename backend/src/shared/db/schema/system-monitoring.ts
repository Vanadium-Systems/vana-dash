import { index, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Track A (monitorizare server) — telemetrie de platformă, nu date de business (fără
// tenant_id, n-avem oricum). Retenție reală prin purge cron la 7 zile
// (jobs/system-metrics-purge.ts), pe lângă `deleted_at` standard.
export const systemMetricsSnapshots = pgTable(
  'system_metrics_snapshots',
  {
    ...standardColumns,
    // 'dash' = the server the app runs on (the only one with alert signals);
    // 'server-1' = an optional second host, display only (CPU/RAM/disk + chart).
    host: text('host').notNull().default('dash'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    cpuPct: real('cpu_pct').notNull(),
    ramPct: real('ram_pct').notNull(),
    diskPct: real('disk_pct').notNull(),
    // Shape: { [containerName: string]: string } — status per container ('healthy'|'starting'|'stopped'|...).
    containersHealthy: jsonb('containers_healthy').notNull(),
  },
  (t) => [
    index('idx_system_metrics_snapshots_captured_at').on(t.capturedAt),
    index('idx_system_metrics_snapshots_host_captured_at').on(t.host, t.capturedAt),
  ],
)

// Un rând fix per semnal ('cpu'|'ram'|'disk'|'containers'|'jobs_failed'|'backup'), seedat
// lazy de motorul de alertare. current_level ca text (nu pgEnum) — set mic, fix, verificat
// la nivel de aplicație (TS union), consecvent cu alte tabele operaționale din proiect.
// signalKey e cheie de business (nu id) — primary key propriu, nu standardColumns.
export const systemAlertState = pgTable('system_alert_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  signalKey: text('signal_key').notNull().unique(),
  currentLevel: text('current_level').notNull().default('green'),
  lastTransitionAt: timestamp('last_transition_at', { withTimezone: true }),
  lastEmailSentAt: timestamp('last_email_sent_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
