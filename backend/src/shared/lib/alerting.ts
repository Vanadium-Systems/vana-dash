import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { alertRules, alerts } from '../db/schema/index.js'
import { config } from '../config.js'
import { sendAlertEmail } from './email.js'
import { textFor, trFor, type LocalizedText } from './i18n.js'
import { notifyPush } from './push.js'

type Severity = 'info' | 'warning' | 'critical'

/**
 * Reguli create on-demand (namespace-uri dinamice: per platformă/semnal, per issue Sentry
 * etc.), nu o listă statică ca ACCOUNTING_RULES din jobs/accounting-alerts.ts — folosit de
 * jobs/platform-ops-alerts.ts, jobs/uptime-monitor.ts, modules/webhooks/sentry-*.
 */
export async function ensureAlertRule(metricKey: string, name: string, severity: Severity = 'critical'): Promise<string> {
  const [existing] = await db
    .select({ id: alertRules.id })
    .from(alertRules)
    .where(and(eq(alertRules.metricKey, metricKey), isNull(alertRules.deletedAt)))
  if (existing) return existing.id

  const [created] = await db
    .insert(alertRules)
    .values({ name, metricKey, condition: 'gt', threshold: '0', severity })
    .returning({ id: alertRules.id })
  return created!.id
}

/**
 * Dedup pe regulă activă (neconfirmată) — nu pe mesaj exact: detaliul poate varia ușor între
 * rulări (ex. "CPU 91%" → "CPU 94%") cât timp problema de fond rămâne aceeași.
 *
 * Respectă `alert_rules.enabled` (2026-09-21 — checkbox-ul din Alerts → Reguli era mort pt.
 * regulile astea create on-demand: metric-alerts.ts/crypto-price-sync.ts sunt singurele care-l
 * citeau, deci Stefan dezactiva o regulă din UI și continua să primească alerta). Dezactivată =
 * tăcere completă, nu doar email — nicio alertă nouă, niciun push.
 */
export async function raiseAlert(
  ruleId: string,
  text: LocalizedText,
  opts?: { severity?: Severity; emailBody?: string; url?: string; email?: boolean },
): Promise<void> {
  // The stored row and the operator's email are in the installation's language; the push
  // below is written again for each person.
  const message = textFor(text, config.defaultLocale)
  const [rule] = await db.select({ enabled: alertRules.enabled }).from(alertRules).where(eq(alertRules.id, ruleId))
  if (!rule?.enabled) return

  const [existing] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.ruleId, ruleId), isNull(alerts.acknowledgedAt)))
  if (existing) return

  const severity = opts?.severity ?? 'critical'
  await db.insert(alerts).values({ ruleId, severity, message })
  // `email: false` — cerere Stefan (2026-09-14): licitații + sync bancar rămân doar
  // alertă în-app + push, fără zgomot suplimentar în inbox.
  if (opts?.email !== false) await sendAlertEmail(message, opts?.emailBody ?? message)
  void notifyPush('alerts', (locale) => ({ title: trFor(locale, 'push.alert.title'), body: textFor(text, locale), url: opts?.url ?? '/alerts' }))
}
