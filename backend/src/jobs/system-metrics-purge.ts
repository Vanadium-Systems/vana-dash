import cron from 'node-cron'
import { lt } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { systemMetricsSnapshots } from '../shared/db/schema/index.js'
import { HISTORY_RETENTION_DAYS } from '../modules/monitoring/service.js'

// Track A: purge zilnic pe system_metrics_snapshots (>7 zile) — trebuie să existe din
// prima zi, nu adăugat mai târziu "când devine o problemă" (creștere nelimitată altfel).
const CRON_EXPR = '0 4 * * *'

export function startSystemMetricsPurgeJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runSystemMetricsPurge()
  })
  console.log(`[system-metrics-purge] Scheduled (${CRON_EXPR})`)
}

export async function runSystemMetricsPurge(): Promise<void> {
  const cutoff = new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const deleted = await db
    .delete(systemMetricsSnapshots)
    .where(lt(systemMetricsSnapshots.capturedAt, cutoff))
    .returning({ id: systemMetricsSnapshots.id })
  console.log(`[system-metrics-purge] purjate ${deleted.length} snapshot(uri) mai vechi de ${HISTORY_RETENTION_DAYS} zile`)
}
