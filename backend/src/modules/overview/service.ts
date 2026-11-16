import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { dashboardConfig, users } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { DEFAULT_COMPANY_LAYOUT, WIDGETS, type HomeLayoutItem } from './widgets.js'

const COMPANY_LAYOUT_KEY = 'home.layout'
const LEGACY_KPIS_KEY = 'overview.visible_kpis'

export type LayoutSource = 'user' | 'company' | 'default'

export class LayoutForbiddenError extends Error {}

function canSee(user: Pick<SessionUser, 'features'>, widget: string): boolean {
  const known = WIDGETS[widget]
  if (!known) return false
  return known.feature === null || user.features.includes(known.feature)
}

// A colleague without money access must not get money widgets even from the company layout.
function visibleTo(user: Pick<SessionUser, 'features'>, layout: HomeLayoutItem[]): HomeLayoutItem[] {
  return layout.filter((item) => canSee(user, item.widget))
}

async function readCompanyLayout(): Promise<HomeLayoutItem[] | null> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, COMPANY_LAYOUT_KEY))
  return row ? (row.value as HomeLayoutItem[]) : null
}

async function writeCompanyLayout(layout: HomeLayoutItem[]): Promise<void> {
  await db
    .insert(dashboardConfig)
    .values({ key: COMPANY_LAYOUT_KEY, value: layout })
    .onConflictDoUpdate({
      target: [dashboardConfig.tenantId, dashboardConfig.key],
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    })
}

export async function getHomeLayout(user: SessionUser): Promise<{ layout: HomeLayoutItem[]; source: LayoutSource }> {
  const [own] = await db.select({ homeLayout: users.homeLayout }).from(users).where(eq(users.id, user.id))
  if (own?.homeLayout) return { layout: visibleTo(user, own.homeLayout as HomeLayoutItem[]), source: 'user' }

  const company = await readCompanyLayout()
  if (company) return { layout: visibleTo(user, company), source: 'company' }

  // The old KPI keys map to nothing here; only the fact that the company had configured the
  // overview carries over. The old row stays: the previous frontend reads it until deploy.
  const [legacy] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, LEGACY_KPIS_KEY))
  if (legacy) {
    await writeCompanyLayout(DEFAULT_COMPANY_LAYOUT)
    return { layout: visibleTo(user, DEFAULT_COMPANY_LAYOUT), source: 'company' }
  }
  return { layout: visibleTo(user, DEFAULT_COMPANY_LAYOUT), source: 'default' }
}

export async function setOwnLayout(user: SessionUser, layout: HomeLayoutItem[]): Promise<void> {
  if (layout.some((item) => !canSee(user, item.widget))) throw new LayoutForbiddenError('widget not available')
  await db.update(users).set({ homeLayout: layout }).where(eq(users.id, user.id))
}

export async function resetOwnLayout(user: SessionUser): Promise<void> {
  await db.update(users).set({ homeLayout: null }).where(eq(users.id, user.id))
}

export async function setCompanyLayout(layout: HomeLayoutItem[]): Promise<void> {
  await writeCompanyLayout(layout)
}
