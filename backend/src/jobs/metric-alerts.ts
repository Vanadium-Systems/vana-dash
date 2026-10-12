import cron from 'node-cron'
import { and, eq, isNull, not, or, lt, sql } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { alertRules, alerts } from '../shared/db/schema/index.js'
import { evaluateMetricRule } from '../shared/lib/metric-alert-evaluation.js'
import { notifyPush } from '../shared/lib/push.js'
import { trFor } from '../shared/lib/i18n.js'

// Motor de threshold real pe platform_metrics (glosarul CLAUDE.md: `revenue < 1000 RON în
// ultima zi`) — namespace `metric_key` disjunct de `accounting.*` (rezervat
// jobs/accounting-alerts.ts, event-based, cron zilnic la 08:00). Rulează orar — un revenue
// drop vrei să-l vezi în ore, nu a doua zi.

const CRON_EXPR = '0 * * * *'

export function startMetricAlertsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void checkMetricAlerts().catch((err) => console.error(`[metric-alerts] ${String(err)}`))
  })
  console.log(`[metric-alerts] Scheduled (${CRON_EXPR})`)
}

export async function checkMetricAlerts(): Promise<void> {
  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        isNull(alertRules.deletedAt),
        eq(alertRules.enabled, true),
        not(sql`${alertRules.metricKey} LIKE 'accounting.%'`),
      ),
    )

  for (const rule of rules) {
    try {
      const { value, triggered } = await evaluateMetricRule(rule)
      if (!triggered) continue

      // Dedup: nu re-emitem cât timp există deja o alertă activă (neconfirmată și
      // nesnooze-uită) pentru regula asta — filozofie identică cu accounting-alerts.ts.
      const now = new Date()
      const [existing] = await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.ruleId, rule.id),
            isNull(alerts.acknowledgedAt),
            or(isNull(alerts.snoozedUntil), lt(alerts.snoozedUntil, now)),
          ),
        )
      if (existing) continue

      const message = `${rule.name}: ${value} ${rule.condition} ${rule.threshold}`
      await db.insert(alerts).values({
        ruleId: rule.id,
        severity: rule.severity,
        message,
      })
      void notifyPush('alerts', (locale) => ({ title: trFor(locale, 'push.alert.title'), body: message, url: '/alerts' }))
    } catch (err) {
      // Failure izolat per regulă (regula #7 CLAUDE.md) — o regulă cu metricKey inexistent
      // sau eroare de agregare nu oprește evaluarea celorlalte.
      console.error(`[metric-alerts] Regula "${rule.name}" (${rule.id}) a eșuat: ${String(err)}`)
    }
  }
}
