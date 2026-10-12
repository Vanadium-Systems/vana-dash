import { and, desc, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { alertRules, alerts, platformMetrics } from '../../shared/db/schema/index.js'
import { evaluateMetricRule } from '../../shared/lib/metric-alert-evaluation.js'
import type {
  CreateAlertRuleSchema,
  ListAlertsQuerySchema,
  SnoozeAlertSchema,
  UpdateAlertRuleSchema,
} from './schema.js'
import type { z } from 'zod'

type CreateRuleInput = z.infer<typeof CreateAlertRuleSchema>
type UpdateRuleInput = z.infer<typeof UpdateAlertRuleSchema>
type ListAlertsQuery = z.infer<typeof ListAlertsQuerySchema>
type SnoozeInput = z.infer<typeof SnoozeAlertSchema>

// ── Reguli ────────────────────────────────────────────────────────────────────

/**
 * Include și namespace-ul `accounting.*` (auto-create de jobs/accounting-alerts.ts). Până pe
 * 2026-09-25 era ascuns de aici, deci alertele de declarații D301/D390 nu se puteau opri din UI,
 * deși job-ul respecta deja `enabled`. Condiția/pragul lor sunt placeholder (event-based), ca la
 * regulile Sentry/licitații care apar deja în listă.
 */
export async function listAlertRules() {
  return db
    .select()
    .from(alertRules)
    .where(isNull(alertRules.deletedAt))
    .orderBy(desc(alertRules.createdAt))
}

export async function createAlertRule(input: CreateRuleInput) {
  const [row] = await db
    .insert(alertRules)
    .values({ ...input, threshold: String(input.threshold) })
    .returning()
  return row
}

export async function updateAlertRule(id: string, input: UpdateRuleInput) {
  const { threshold, ...rest } = input
  const [row] = await db
    .update(alertRules)
    .set({
      ...rest,
      ...(threshold !== undefined ? { threshold: String(threshold) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(alertRules.id, id), isNull(alertRules.deletedAt)))
    .returning()
  return row
}

export async function deleteAlertRule(id: string) {
  const [row] = await db
    .update(alertRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(alertRules.id, id), isNull(alertRules.deletedAt)))
    .returning()
  return row
}

/** Dry-run — nu inserează nimic, doar confirmă dacă pragul e corect setat chiar acum. */
export async function testAlertRule(id: string) {
  const [rule] = await db.select().from(alertRules).where(and(eq(alertRules.id, id), isNull(alertRules.deletedAt)))
  if (!rule) return null
  return evaluateMetricRule(rule)
}

// ── Alerte ────────────────────────────────────────────────────────────────────

export async function listAlerts(query: ListAlertsQuery) {
  const now = new Date()
  const filters = []
  if (query.status === 'active') {
    filters.push(isNull(alerts.acknowledgedAt), or(isNull(alerts.snoozedUntil), lt(alerts.snoozedUntil, now)))
  } else if (query.status === 'acknowledged') {
    filters.push(isNotNull(alerts.acknowledgedAt))
  }

  return db
    .select({
      id: alerts.id,
      ruleId: alerts.ruleId,
      ruleName: alertRules.name,
      severity: alerts.severity,
      message: alerts.message,
      triggeredAt: alerts.triggeredAt,
      acknowledgedAt: alerts.acknowledgedAt,
      snoozedUntil: alerts.snoozedUntil,
    })
    .from(alerts)
    .innerJoin(alertRules, eq(alerts.ruleId, alertRules.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(alerts.triggeredAt))
}

/** Câte alerte active neconfirmate — folosit de badge-ul din sidebar. COUNT în SQL (regula #9). */
export async function countActiveAlerts(): Promise<number> {
  const now = new Date()
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(alerts)
    .where(and(isNull(alerts.acknowledgedAt), or(isNull(alerts.snoozedUntil), lt(alerts.snoozedUntil, now))))
  return row?.count ?? 0
}

export async function ackAlert(id: string) {
  const [row] = await db.update(alerts).set({ acknowledgedAt: new Date() }).where(eq(alerts.id, id)).returning()
  return row
}

export async function snoozeAlert(id: string, input: SnoozeInput) {
  const snoozedUntil = new Date(Date.now() + input.days * 24 * 3600 * 1000)
  const [row] = await db.update(alerts).set({ snoozedUntil }).where(eq(alerts.id, id)).returning()
  return row
}

/** Ack în masă (Contract F) — doar alertele neconfirmate; întoarce câte au fost atinse. */
export async function ackBulk(ruleId?: string): Promise<number> {
  const filters = [isNull(alerts.acknowledgedAt)]
  if (ruleId) filters.push(eq(alerts.ruleId, ruleId))
  const rows = await db
    .update(alerts)
    .set({ acknowledgedAt: new Date() })
    .where(and(...filters))
    .returning({ id: alerts.id })
  return rows.length
}

/**
 * Seria brută a metricii regulii în fereastra ei — pt. sparkline-ul din UI (Contract F).
 * Puncte la rezoluția reală din platform_metrics, nu agregare zilnică: pentru metricile de
 * preț (crypto.*) SUM-ul zilnic ar fi lipsit de sens, iar AVG ar ascunde variația care
 * exact pe ea se bazează alerta.
 */
export async function getRuleSparkline(id: string): Promise<{ points: Array<{ t: string; v: number }> } | null> {
  const [rule] = await db
    .select({ metricKey: alertRules.metricKey, platformId: alertRules.platformId, windowHours: alertRules.windowHours })
    .from(alertRules)
    .where(and(eq(alertRules.id, id), isNull(alertRules.deletedAt)))
  if (!rule) return null

  const since = new Date(Date.now() - rule.windowHours * 60 * 60 * 1000)
  const filters = [
    eq(platformMetrics.metricKey, rule.metricKey),
    gte(platformMetrics.recordedAt, since),
    isNull(platformMetrics.deletedAt),
  ]
  if (rule.platformId) filters.push(eq(platformMetrics.platformId, rule.platformId))

  // Ultimele 120 de mostre, în ordine cronologică — suficient pt. un sparkline de ~120px.
  const raw = await db
    .select({ t: platformMetrics.recordedAt, v: platformMetrics.value })
    .from(platformMetrics)
    .where(and(...filters))
    .orderBy(desc(platformMetrics.recordedAt))
    .limit(120)

  return { points: raw.reverse().map((r) => ({ t: r.t.toISOString(), v: Number(r.v) })) }
}
