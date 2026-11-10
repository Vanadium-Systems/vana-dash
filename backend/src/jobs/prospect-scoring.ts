import cron from 'node-cron'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { recomputeSignals } from '../modules/prospects/score-signals-service.js'
import { recalculateAllScores } from '../modules/prospects/service.js'

const CRON_EXPR = '0 3 * * *'

export function startProspectScoringJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runProspectScoringJob()
  })
  console.log(`[prospect-scoring] Scheduled (${CRON_EXPR})`)
}

export async function runProspectScoringJob(): Promise<void> {
  try {
    await forEachTenant(async (tenantId) => {
      // Signals first: the criteria of the score can use them.
      await recomputeSignals()
      const scored = await recalculateAllScores()
      console.log(`[prospect-scoring] tenant ${tenantId}: ${scored} scores`)
    })
  } catch (err) {
    console.error('[prospect-scoring] failed:', err)
  }
}
