import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { dashboardConfig } from '../../shared/db/schema/index.js'
import type { z } from 'zod'
import { availableCountries } from '../../countries/index.js'
import { getCompany, updateCompany } from '../../shared/lib/company.js'
import type { CompanySettingsUpdateSchema, NavLayoutUpdateSchema, OpsJobToggles } from './schema.js'

// Pattern identic cu overview-config (modules/metrics/service.ts): un singur rând jsonb în
// dashboard_config; lipsa lui = default canonic din cod (comportamentul de azi).

const NAV_LAYOUT_KEY = 'nav.layout'

export interface NavLayoutEntry {
  to: string
  visible: boolean
}

export async function getNavLayout(): Promise<NavLayoutEntry[] | null> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, NAV_LAYOUT_KEY))
  return row ? (row.value as NavLayoutEntry[]) : null
}

export async function setNavLayout(input: z.infer<typeof NavLayoutUpdateSchema>): Promise<NavLayoutEntry[]> {
  await db
    .insert(dashboardConfig)
    .values({ key: NAV_LAYOUT_KEY, value: input.items })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
  return input.items
}

export async function getCompanySettings() {
  const { country, timeZone, currency, profile } = await getCompany()
  return { profile, country, timeZone, currency, countries: availableCountries() }
}

export async function setCompanySettings(input: z.infer<typeof CompanySettingsUpdateSchema>) {
  await updateCompany(input)
  return getCompanySettings()
}

const OPS_JOB_TOGGLES_KEY = 'ops_jobs.enabled'

const DEFAULT_OPS_JOB_TOGGLES: OpsJobToggles = { bankSync: true, tenderWatch: true, bnrFeed: true }

// Citit direct de cron-urile respective (jobs/sync-bank.ts, jobs/tender-watch-sync.ts,
// jobs/bnr-daily-fetch.ts) la fiecare rulare — lipsa rândului = toate active (comportamentul
// de azi).
export async function getOpsJobToggles(): Promise<OpsJobToggles> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, OPS_JOB_TOGGLES_KEY))
  if (!row) return DEFAULT_OPS_JOB_TOGGLES
  return { ...DEFAULT_OPS_JOB_TOGGLES, ...(row.value as Partial<OpsJobToggles>) }
}

export async function setOpsJobToggles(patch: Partial<OpsJobToggles>): Promise<OpsJobToggles> {
  const next = { ...(await getOpsJobToggles()), ...patch }
  await db
    .insert(dashboardConfig)
    .values({ key: OPS_JOB_TOGGLES_KEY, value: next })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
  return next
}
