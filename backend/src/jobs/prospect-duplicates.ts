import cron from 'node-cron'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { recomputeDuplicates } from '../modules/prospects/health-service.js'

const CRON_EXPR = '15 * * * *'

export function startProspectDuplicatesJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runProspectDuplicatesJob()
  })
  console.log(`[prospect-duplicates] Scheduled (${CRON_EXPR})`)
}

export async function runProspectDuplicatesJob(): Promise<void> {
  try {
    await forEachTenant(async (tenantId) => {
      const { pairs } = await recomputeDuplicates()
      console.log(`[prospect-duplicates] tenant ${tenantId}: ${pairs.length} pairs`)
    })
  } catch (err) {
    console.error('[prospect-duplicates] failed:', err)
  }
}
