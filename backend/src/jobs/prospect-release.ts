import cron from 'node-cron'
import { config } from '../shared/config.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { runProspectRelease } from '../modules/prospects/release-service.js'

const CRON_EXPR = '0 6 * * *'

export function startProspectReleaseJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runProspectReleaseJob()
  })
  console.log(`[prospect-release] Scheduled (${CRON_EXPR})`)
}

export async function runProspectReleaseJob(): Promise<void> {
  try {
    await forEachTenant(async (tenantId) => {
      const { released, warned } = await runProspectRelease(config.defaultLocale)
      if (released > 0 || warned > 0) console.log(`[prospect-release] tenant ${tenantId}: released ${released}, warned ${warned}`)
    })
  } catch (err) {
    console.error('[prospect-release] failed:', err)
  }
}
