import cron from 'node-cron'
import { db } from '../shared/db/client.js'
import { syncLog } from '../shared/db/schema/index.js'
import { countBatchObjects, listExpiredBatches, purgeBatches } from '../modules/archive/trash.js'
import { purgeExpiredNotes } from '../modules/notes/service.js'

// Empties the Trashes (Archive, Notes) of whatever is past its 30 days. R2 deletes are irreversible, so the run is
// capped and goes one batch at a time: a failing batch stays for tomorrow, the rest continue.
const CRON_EXPR = '30 3 * * *'
const MAX_BATCHES = 20
const MAX_OBJECTS = 2000
const MAX_NOTES = 200

export function startTrashPurgeJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runTrashPurge()
  })
  console.log(`[trash-purge] Scheduled (${CRON_EXPR})`)
}

export async function runTrashPurge(): Promise<{ batches: number; objects: number; notes: number; failed: number }> {
  const startedAt = new Date()
  const notes = await purgeExpiredNotes(MAX_NOTES).catch((err) => {
    console.error('[trash-purge] notes failed:', err)
    return 0
  })
  let batches = 0
  let objects = 0
  const errors: string[] = []
  for (const batchId of await listExpiredBatches(MAX_BATCHES)) {
    const pending = await countBatchObjects(batchId)
    if (objects > 0 && objects + pending > MAX_OBJECTS) break
    try {
      const done = await purgeBatches([batchId])
      batches += done.batches
      objects += done.objects
    } catch (err) {
      errors.push(`${batchId}: ${String(err)}`)
    }
  }
  if (batches > 0 || errors.length > 0) {
    await db.insert(syncLog).values({
      jobKey: 'archive:trash-purge',
      status: errors.length > 0 ? 'FAILED' : 'SUCCESS',
      recordsSync: batches,
      errorMessage: errors.length > 0 ? errors.join('\n').slice(0, 2000) : null,
      startedAt,
      finishedAt: new Date(),
    })
    console.log(`[trash-purge] ${batches} batches, ${objects} R2 objects, ${errors.length} failed`)
  }
  if (notes > 0) console.log(`[trash-purge] ${notes} notes`)
  return { batches, objects, notes, failed: errors.length }
}
