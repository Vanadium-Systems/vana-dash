import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { dashboardConfig } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'

const SETTINGS_KEY = 'contract.notice'
const DEFAULT_LEAD_DAYS = 14

export interface NoticeSettings {
  /** How many days before the notice deadline the alert goes out. */
  leadDays: number
  lastRunAt: string | null
}

export async function getNoticeSettings(): Promise<NoticeSettings> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, SETTINGS_KEY))
  const saved = (row?.value ?? {}) as Partial<NoticeSettings>
  return { leadDays: saved.leadDays ?? DEFAULT_LEAD_DAYS, lastRunAt: saved.lastRunAt ?? null }
}

async function save(next: NoticeSettings) {
  await db
    .insert(dashboardConfig)
    .values({ key: SETTINGS_KEY, value: next })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

export async function updateNoticeSettings(input: { leadDays: number }): Promise<NoticeSettings> {
  const current = await getNoticeSettings()
  const next = { ...current, leadDays: input.leadDays }
  await save(next)
  await recordAudit({ action: 'contract.setari.modificate', entityType: 'contract_settings', changes: { leadDays: [current.leadDays, next.leadDays] } })
  return next
}

export async function recordNoticeRun(at: Date): Promise<void> {
  await save({ ...(await getNoticeSettings()), lastRunAt: at.toISOString() })
}
