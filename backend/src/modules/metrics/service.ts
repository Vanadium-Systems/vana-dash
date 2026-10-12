import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { dashboardConfig, platformMetrics, platforms } from '../../shared/db/schema/index.js'
import type { PeriodRange } from '../../shared/lib/period.js'

const OVERVIEW_CONFIG_KEY = 'overview.visible_kpis'
const DEFAULT_VISIBLE_KPIS = ['active_clients', 'user_count', 'mrr']

// Same pattern as the self-serve pricing toggle in `vanagreen-ingest/service.ts`: the row is
// missing from `dashboard_config` until the first explicit PUT, and the default below is the
// set of cards the overview page used to hard-code.
export async function getOverviewConfig(): Promise<{ visibleKpis: string[] }> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, OVERVIEW_CONFIG_KEY))
  return { visibleKpis: row ? (row.value as string[]) : DEFAULT_VISIBLE_KPIS }
}

export async function setOverviewConfig(visibleKpis: string[]): Promise<void> {
  await db
    .insert(dashboardConfig)
    .values({ key: OVERVIEW_CONFIG_KEY, value: visibleKpis })
    .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

// Toată agregarea se face în SQL (regula #9) — niciodată .reduce() în JS.

function baseFilters(range: PeriodRange, platformId?: string) {
  const filters = [
    isNull(platformMetrics.deletedAt),
    gte(platformMetrics.recordedAt, range.from),
    lte(platformMetrics.recordedAt, range.to),
  ]
  if (platformId) filters.push(eq(platformMetrics.platformId, platformId))
  return filters
}

// Pentru fiecare metric key din perioadă: suma, ultima valoare și timestamp-ul ei.
// KPI-urile de tip gauge (mrr, active_clients) folosesc `latest`;
// cele de tip flow (revenue pe zile) folosesc `total`.
export async function getSummary(range: PeriodRange, platformId?: string) {
  return db
    .select({
      metricKey: platformMetrics.metricKey,
      unit: sql<string | null>`MAX(${platformMetrics.unit})`,
      total: sql<number>`SUM(${platformMetrics.value}::numeric)::float`,
      latest: sql<number>`(ARRAY_AGG(${platformMetrics.value}::float ORDER BY ${platformMetrics.recordedAt} DESC))[1]`,
      latestAt: sql<string>`MAX(${platformMetrics.recordedAt})`,
    })
    .from(platformMetrics)
    .innerJoin(platforms, and(eq(platformMetrics.platformId, platforms.id), isNull(platforms.deletedAt)))
    .where(and(...baseFilters(range, platformId)))
    .groupBy(platformMetrics.metricKey)
}

// Serie zilnică pentru o metrică: SUM peste platforme (sau doar una) per zi.
export async function getSeries(metricKey: string, range: PeriodRange, platformId?: string) {
  const day = sql<string>`DATE_TRUNC('day', ${platformMetrics.recordedAt})`
  return db
    .select({
      date: day,
      value: sql<number>`SUM(${platformMetrics.value}::numeric)::float`,
    })
    .from(platformMetrics)
    .innerJoin(platforms, and(eq(platformMetrics.platformId, platforms.id), isNull(platforms.deletedAt)))
    .where(and(eq(platformMetrics.metricKey, metricKey), ...baseFilters(range, platformId)))
    .groupBy(day)
    .orderBy(day)
}
