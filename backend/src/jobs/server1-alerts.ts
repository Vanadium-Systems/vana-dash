import cron from 'node-cron'
import { getSecondaryHostSignals, SIGNAL_LABELS } from '../modules/monitoring/service.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'

// server-1, the optional second monitored host: in-app alert and push only, no email. The
// CPU/RAM/disk thresholds are the ones used for dash (red = alert). Offline after 10 minutes
// without a snapshot, not 5 as on the page: a short connection drop is not worth a push.

const CRON_EXPR = '*/5 * * * *'
const OFFLINE_AFTER_MS = 10 * 60 * 1000

export function startServer1AlertsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void checkServer1Alerts().catch((err) => console.error(`[server1-alerts] ${String(err)}`))
  })
  console.log(`[server1-alerts] Scheduled (${CRON_EXPR})`)
}

export async function checkServer1Alerts(): Promise<void> {
  const { lastCapturedAt, signals } = await getSecondaryHostSignals('server-1')
  // Colectorul n-a trimis niciodată nimic — nu e „offline", doar neinstalat.
  if (!lastCapturedAt) return

  if (Date.now() - lastCapturedAt.getTime() > OFFLINE_AFTER_MS) {
    const minutes = Math.round((Date.now() - lastCapturedAt.getTime()) / 60_000)
    const ruleId = await ensureAlertRule('server1.offline', tr('alerts.rules.server1Silent'))
    await raiseAlert(ruleId, tl('alerts.jobs.server1Silent', { minutes }), {
      url: '/system-health',
      email: false,
    })
    return
  }

  for (const signal of signals) {
    if (signal.level !== 'red') continue
    const ruleId = await ensureAlertRule(`server1.${signal.key}`, tr('alerts.rules.server1Signal', { signal: SIGNAL_LABELS[signal.key] }))
    await raiseAlert(ruleId, `server-1: ${SIGNAL_LABELS[signal.key]} ${signal.detail}`, { url: '/system-health', email: false })
  }
}
