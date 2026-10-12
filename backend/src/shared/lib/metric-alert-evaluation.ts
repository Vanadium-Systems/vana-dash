import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { platformMetrics } from '../db/schema/index.js'

export type AlertCondition = 'lt' | 'lte' | 'gt' | 'gte'

export interface MetricAlertRuleLike {
  metricKey: string
  condition: AlertCondition
  threshold: string | number
  windowHours: number
  platformId: string | null
}

export function checkCondition(value: number, condition: AlertCondition, threshold: number): boolean {
  switch (condition) {
    case 'lt':
      return value < threshold
    case 'lte':
      return value <= threshold
    case 'gt':
      return value > threshold
    case 'gte':
      return value >= threshold
  }
}

/**
 * Evaluare pură (read-only) a unei reguli de threshold pe `platform_metrics` — SUM peste
 * fereastra `windowHours`, exact semantica din exemplul canonic din CLAUDE.md
 * (`revenue < 1000 RON în ultima zi` = suma zilei). Extrasă în shared/lib ca să fie
 * reutilizată identic de `jobs/metric-alerts.ts` (cron, poate insera o alertă) ȘI de
 * `modules/alerts/service.ts` (`POST /alert-rules/:id/test`, dry-run, niciodată nu scrie) —
 * regula #6 CLAUDE.md (cron jobs ≠ route handlers) nu e încălcată: ruta nu pornește un sync,
 * doar citește aceeași agregare pură pe care o folosește și jobul.
 *
 * Excepție: `crypto.*` e metrică de tip GAUGE (preț la momentul t), nu flux — SUM peste mostre
 * ar fi dependent de frecvența sync-ului și fără sens fizic; AVG dă prețul mediu din fereastră,
 * comparabil cu pragul setat de Stefan.
 */
export async function evaluateMetricRule(rule: MetricAlertRuleLike): Promise<{ value: number; triggered: boolean }> {
  const since = new Date(Date.now() - rule.windowHours * 60 * 60 * 1000)
  const filters = [
    eq(platformMetrics.metricKey, rule.metricKey),
    gte(platformMetrics.recordedAt, since),
    isNull(platformMetrics.deletedAt),
  ]
  if (rule.platformId) filters.push(eq(platformMetrics.platformId, rule.platformId))

  const aggregate = rule.metricKey.startsWith('crypto.') ? 'AVG' : 'SUM'
  const [row] = await db
    .select({ total: sql<number>`COALESCE(${sql.raw(aggregate)}(${platformMetrics.value}::numeric), 0)::float` })
    .from(platformMetrics)
    .where(and(...filters))

  const value = row?.total ?? 0
  const triggered = checkCondition(value, rule.condition, Number(rule.threshold))
  return { value, triggered }
}
