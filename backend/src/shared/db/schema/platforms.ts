import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Structura mapărilor conectorului generic — declarată structural identic aici (DB nu
// importă din connectors/, izolare de layere), sursa canonică: connectors/generic/types.ts.
export interface PlatformMetricMapping {
  metricKey: string
  unit?: string
  path: string
  kind: 'number'
}

export const platforms = pgTable('platforms', {
  ...tenantColumns,
  ...standardColumns,
  name: text('name').notNull(),
  // Cheia din connectors/index.ts registry (ex: 'vanagreen')
  type: text('type').notNull(),
  apiUrl: text('api_url').notNull(),
  // API key criptat AES-256-GCM (shared/lib/crypto.ts). Nu ajunge NICIODATĂ în response.
  apiKeyEnc: text('api_key_enc').notNull(),
  syncCron: text('sync_cron').notNull().default('*/30 * * * *'),
  healthStatus: text('health_status', { enum: ['unknown', 'healthy', 'degraded', 'down'] })
    .notNull()
    .default('unknown'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  // Doar pt. type='generic' — mapări metrică→rută JSON, editabile din UI (sprint
  // de-hardcodare 2026-08-25): [{ metricKey, unit, path, kind }] + healthPath mai jos.
  metricMappings: jsonb('metric_mappings').$type<PlatformMetricMapping[]>(),
  healthPath: text('health_path'),
})
