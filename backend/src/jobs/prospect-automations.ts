import cron from 'node-cron'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { registerAutomationListeners, runNoNextStep } from '../modules/prospects/automations-service.js'

const CRON_EXPR = '0 7 * * *'

export function startProspectAutomationsJob(): void {
  registerAutomationListeners()
  cron.schedule(CRON_EXPR, () => {
    void runProspectAutomationsJob()
  })
  console.log(`[prospect-automations] Scheduled (${CRON_EXPR})`)
}

export async function runProspectAutomationsJob(): Promise<void> {
  try {
    await forEachTenant(async (tenantId) => {
      try {
        const counted = await runNoNextStep()
        if (counted > 0) console.log(`[prospect-automations] tenant ${tenantId}: ${counted} without a next step`)
      } catch (err) {
        console.error('[automations] no_next_step:', err)
      }
    })
  } catch (err) {
    console.error('[prospect-automations] failed:', err)
  }
}
