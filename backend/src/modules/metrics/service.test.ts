/**
 * modules/metrics/service.ts#getOverviewConfig/setOverviewConfig — pattern identic
 * vanagreen-ingest self-serve pricing toggle (dashboard_config, default implicit până la primul
 * PUT). Integration test, pg real (test/setup.ts).
 */
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { dashboardConfig } from '../../shared/db/schema/index.js'
import { getOverviewConfig, setOverviewConfig } from './service.js'

const CONFIG_KEY = 'overview.visible_kpis'

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, CONFIG_KEY))
})

describe('getOverviewConfig / setOverviewConfig', () => {
  it('întoarce default-ul (activeClients/userCount/mrr) când niciun rând nu există încă', async () => {
    await db.delete(dashboardConfig).where(eq(dashboardConfig.key, CONFIG_KEY))
    expect(await getOverviewConfig()).toEqual({ visibleKpis: ['active_clients', 'user_count', 'mrr'] })
  })

  it('reflectă valoarea setată odată ce Stefan salvează', async () => {
    await setOverviewConfig(['mrr', 'vanagreen.demo_clients'])
    expect(await getOverviewConfig()).toEqual({ visibleKpis: ['mrr', 'vanagreen.demo_clients'] })
  })

  it('un array gol e valid — ascunde toate KPI-urile opționale', async () => {
    await setOverviewConfig([])
    expect(await getOverviewConfig()).toEqual({ visibleKpis: [] })
  })
})
