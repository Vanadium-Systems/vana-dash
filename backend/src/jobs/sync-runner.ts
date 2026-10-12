import cron, { type ScheduledTask } from 'node-cron'
import { isNull } from 'drizzle-orm'
import { getConnector } from '../connectors/index.js'
import { db } from '../shared/db/client.js'
import { platforms } from '../shared/db/schema/index.js'
import { runConnectorSync } from '../shared/lib/sync.js'

// Orchestrator: un cron job per platformă, după platforms.sync_cron.
// Route handlers nu pornesc sync-uri direct — apelează triggerSyncNow / rescheduleSyncJobs.

const jobs = new Map<string, ScheduledTask>()

export async function startSyncRunner(): Promise<void> {
  await rescheduleSyncJobs()
}

export async function rescheduleSyncJobs(): Promise<void> {
  for (const job of jobs.values()) job.stop()
  jobs.clear()

  const rows = await db.select().from(platforms).where(isNull(platforms.deletedAt))
  for (const platform of rows) {
    // Platforme fără connector (ex: 'crypto' — rândul există doar ca părinte FK pentru
    // metricile crypto.* scrise de jobs/crypto-price-sync.ts) nu primesc job de sync:
    // altfel runConnectorSync ar scrie un FAILED "Unknown platform type" la fiecare cron
    // și digest-ul de job-uri eșuate ar suna în gol.
    let hasConnector = true
    try {
      getConnector(platform.type)
    } catch {
      hasConnector = false
    }
    if (!hasConnector) {
      console.warn(`[sync-runner] Niciun connector pt. tipul "${platform.type}" (${platform.name}) — fără sync job`)
      continue
    }
    if (!cron.validate(platform.syncCron)) {
      console.error(`[sync-runner] Invalid cron "${platform.syncCron}" for platform ${platform.name} — skipped`)
      continue
    }
    const task = cron.schedule(platform.syncCron, () => {
      // runConnectorSync nu aruncă niciodată (failure izolat în sync_log)
      void runConnectorSync(platform)
    })
    jobs.set(platform.id, task)
  }
  console.log(`[sync-runner] Scheduled ${jobs.size} platform sync job(s)`)
}

export async function triggerSyncNow(platformId: string): Promise<void> {
  const rows = await db.select().from(platforms).where(isNull(platforms.deletedAt))
  const platform = rows.find((p) => p.id === platformId)
  if (!platform) throw new Error('Platform not found')
  await runConnectorSync(platform)
}
