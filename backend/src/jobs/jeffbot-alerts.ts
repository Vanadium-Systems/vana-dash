import { and, eq, gte } from 'drizzle-orm'
import cron from 'node-cron'
import { getLatestReview, getState, STALE_AFTER_MS } from '../modules/jeffbot/service.js'
import { db } from '../shared/db/client.js'
import { alerts } from '../shared/db/schema/index.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'

// Alerts for the external paper trading bot. raiseAlert deduplicates only while the alert is
// unacknowledged; here a state lasts for hours (bot stopped overnight, a critical review that
// stays the latest until tomorrow), so an acknowledged alert would come back every 5 minutes.
// Each rule alerts once per episode: nothing new if an alert already exists since the episode
// began, acknowledged or not.

const CRON_EXPR = '*/5 * * * *'
const OFFLINE_AFTER_MS = 30 * 60 * 1000
// Serviciile nu au un „de când" în snapshot — o alertă per serviciu la cel mult 6 ore.
const SERVICE_REALERT_MS = 6 * 60 * 60 * 1000
const URL = '/crypto?tab=bot'
// Serviciul de bursă (Contract C) are tab-ul lui în Assets; restul alertelor rămân pe Crypto.
const serviceUrl = (name: string) => (name === 'jeffbot-stocks' ? '/assets?tab=bot' : URL)

export function startJeffbotAlertsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void checkJeffbotAlerts().catch((err) => console.error(`[jeffbot-alerts] ${String(err)}`))
  })
  console.log(`[jeffbot-alerts] Scheduled (${CRON_EXPR})`)
}

async function alertedSince(ruleId: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.ruleId, ruleId), gte(alerts.triggeredAt, since)))
    .limit(1)
  return Boolean(row)
}

export async function checkJeffbotAlerts(now = new Date()): Promise<void> {
  const state = await getState()
  if (!state) return

  const ageMs = now.getTime() - state.receivedAt.getTime()
  if (ageMs > OFFLINE_AFTER_MS) {
    const ruleId = await ensureAlertRule('jeffbot.offline', tr('alerts.rules.botSilent'), 'critical')
    if (!(await alertedSince(ruleId, state.receivedAt))) {
      const minutes = Math.round(ageMs / 60_000)
      await raiseAlert(ruleId, tl('alerts.jobs.botSilent', { minutes }), { severity: 'critical', url: URL })
    }
  } else if (ageMs <= STALE_AFTER_MS) {
    for (const service of state.payload.services) {
      if (service.state === 'active') continue
      const ruleId = await ensureAlertRule(`jeffbot.service.${service.name}`, `jeffbot — ${service.name} oprit`, 'warning')
      if (await alertedSince(ruleId, new Date(now.getTime() - SERVICE_REALERT_MS))) continue
      await raiseAlert(ruleId, tl('alerts.jobs.botServiceState', { name: service.name, state: service.state }), {
        severity: 'warning',
        url: serviceUrl(service.name),
        email: false,
      })
    }
  }

  const review = await getLatestReview()
  if (review?.severity === 'critical') {
    const ruleId = await ensureAlertRule('jeffbot.review.critical', tr('alerts.rules.botCriticalReview'), 'critical')
    if (!(await alertedSince(ruleId, review.receivedAt))) {
      const key = review.kind === 'weekly' ? 'alerts.jobs.botWeeklyReview' : 'alerts.jobs.botDailyReview'
      await raiseAlert(ruleId, tl(key, { date: review.date, summary: review.summary }), { severity: 'critical', url: URL })
    }
  }
}
