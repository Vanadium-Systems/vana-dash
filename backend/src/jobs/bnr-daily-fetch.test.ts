/**
 * jobs/bnr-daily-fetch.ts — cron zilnic EUR+USD (Sprint D, Track 2). Unit test, orchestrare
 * doar: mockuim `fetchAndStoreLatestBnrRates` (are propriile teste în shared/lib/bnr.test.ts)
 * și verificăm că job-ul o apelă o singură dată și NU aruncă mai departe la eșec (regula #7
 * CLAUDE.md — connector/job failure izolat).
 *
 * Alertă (2026-08-18): feed-ul BNR s-a spart silențios 13 zile (doar `console.error`, nimeni
 * nu s-a uitat în logs) până a fost observat indirect ca lentoare de 3-5s pe /api/plan și
 * /api/reports/*. Verificăm acum și că eșecul ajunge vizibil în `alerts` (pg real, ca în
 * platform-ops-alerts.test.ts), nu doar în consolă.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { alertRules, alerts } from '../shared/db/schema/index.js'

const fetchRatesMock = vi.fn()

vi.mock('../shared/lib/bnr.js', () => ({
  fetchAndStoreLatestBnrRates: (...args: unknown[]) => fetchRatesMock(...args),
}))

const { runBnrDailyFetchJob } = await import('./bnr-daily-fetch.js')

const RULE_KEY = 'bnr_feed.fetch_failed'

async function cleanupAlerts() {
  const [rule] = await db.select({ id: alertRules.id }).from(alertRules).where(eq(alertRules.metricKey, RULE_KEY))
  if (!rule) return
  await db.delete(alerts).where(eq(alerts.ruleId, rule.id))
  await db.delete(alertRules).where(eq(alertRules.id, rule.id))
}

beforeEach(async () => {
  fetchRatesMock.mockReset()
  await cleanupAlerts()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupAlerts()
})

describe('runBnrDailyFetchJob', () => {
  it('fetches EUR+USD necondiționat, o singură dată', async () => {
    fetchRatesMock.mockResolvedValue([
      { date: '2026-07-17', currency: 'EUR', rate: '4.980000' },
      { date: '2026-07-17', currency: 'USD', rate: '4.570000' },
    ])

    await runBnrDailyFetchJob()

    expect(fetchRatesMock).toHaveBeenCalledTimes(1)
    expect(fetchRatesMock).toHaveBeenCalledWith(['EUR', 'USD'])
  })

  it('nu aruncă mai departe dacă BNR e jos — job-ul se termină curat', async () => {
    fetchRatesMock.mockRejectedValue(new Error('BNR jos'))

    await expect(runBnrDailyFetchJob()).resolves.toBeUndefined()
  })

  it('ridică o alertă vizibilă în /api/alerts când BNR e jos', async () => {
    fetchRatesMock.mockRejectedValue(new Error('BNR jos'))

    await runBnrDailyFetchJob()

    const [rule] = await db.select().from(alertRules).where(and(eq(alertRules.metricKey, RULE_KEY), isNull(alertRules.deletedAt)))
    expect(rule).toBeDefined()
    const raised = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(raised).toHaveLength(1)
    expect(raised[0]?.severity).toBe('warning')
    expect(raised[0]?.message).toContain('BNR jos')
  })

  it('nu re-emite cât timp alerta anterioară e încă activă (dedup)', async () => {
    fetchRatesMock.mockRejectedValue(new Error('BNR jos'))

    await runBnrDailyFetchJob()
    await runBnrDailyFetchJob()

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, RULE_KEY))
    const raised = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(raised).toHaveLength(1)
  })
})
