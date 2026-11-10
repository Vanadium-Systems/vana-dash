import cron from 'node-cron'
import { config } from '../shared/config.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { runViewAlerts } from '../modules/prospects/views-service.js'

const CRON_EXPR = '0 8 * * *'

export function startProspectViewAlertsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runProspectViewAlertsJob()
  })
  console.log(`[prospect-view-alerts] Scheduled (${CRON_EXPR})`)
}

export async function runProspectViewAlertsJob(): Promise<void> {
  try {
    await forEachTenant(async (tenantId) => {
      const { notified } = await runViewAlerts(config.defaultLocale)
      if (notified > 0) console.log(`[prospect-view-alerts] tenant ${tenantId}: notified ${notified}`)
    })
  } catch (err) {
    console.error('[prospect-view-alerts] failed:', err)
  }
}
