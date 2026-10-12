/**
 * Integration test — pg real (test/setup.ts). Verifică evaluarea threshold-ului
 * (SUM peste window_hours) + dedup (nu re-emite cât timp alerta e activă) +
 * failure izolat per regulă (regula #7 CLAUDE.md).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../shared/db/client.js'
import { alertRules, alerts, platformMetrics, platforms } from '../shared/db/schema/index.js'
import { checkMetricAlerts } from './metric-alerts.js'

const METRIC_KEY = 'qa.metric_alerts_test_revenue'
let platformId = ''
const platformIds: string[] = []
const ruleIds: string[] = []

async function alertsForRule(ruleId: string) {
  return db.select().from(alerts).where(eq(alerts.ruleId, ruleId))
}

beforeEach(async () => {
  const [platform] = await db
    .insert(platforms)
    .values({
      name: 'QA Metric Alerts Platform',
      type: 'vanagreen',
      apiUrl: 'https://example.invalid',
      apiKeyEnc: 'qa-test-not-a-real-encrypted-key',
    })
    .returning({ id: platforms.id })
  platformId = platform!.id
  platformIds.push(platformId)
})

afterAll(async () => {
  if (ruleIds.length) await db.delete(alertRules).where(inArray(alertRules.id, ruleIds))
  if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds))
})

describe('checkMetricAlerts', () => {
  it('declanșează o alertă când SUM peste fereastră trece pragul', async () => {
    const [rule] = await db
      .insert(alertRules)
      .values({
        name: 'QA revenue drop',
        metricKey: METRIC_KEY,
        condition: 'lt',
        threshold: '1000',
        windowHours: 24,
        severity: 'critical',
        platformId,
        enabled: true,
      })
      .returning()
    ruleIds.push(rule!.id)

    await db.insert(platformMetrics).values({
      platformId,
      metricKey: METRIC_KEY,
      value: '200',
      recordedAt: new Date(),
    })

    await checkMetricAlerts()

    const raised = await alertsForRule(rule!.id)
    expect(raised).toHaveLength(1)
    expect(raised[0]?.severity).toBe('critical')
  })

  it('nu re-emite cât timp alerta anterioară e încă activă (dedup)', async () => {
    const [rule] = await db
      .insert(alertRules)
      .values({
        name: 'QA revenue drop dedup',
        metricKey: METRIC_KEY,
        condition: 'lt',
        threshold: '1000',
        windowHours: 24,
        enabled: true,
        platformId,
      })
      .returning()
    ruleIds.push(rule!.id)

    await db.insert(platformMetrics).values({
      platformId,
      metricKey: METRIC_KEY,
      value: '50',
      recordedAt: new Date(),
    })

    await checkMetricAlerts()
    await checkMetricAlerts()

    const raised = await alertsForRule(rule!.id)
    expect(raised).toHaveLength(1)
  })

  it('nu declanșează dacă valoarea nu trece pragul', async () => {
    const [rule] = await db
      .insert(alertRules)
      .values({
        name: 'QA revenue ok',
        metricKey: METRIC_KEY,
        condition: 'lt',
        threshold: '10',
        windowHours: 24,
        enabled: true,
        platformId,
      })
      .returning()
    ruleIds.push(rule!.id)

    await db.insert(platformMetrics).values({
      platformId,
      metricKey: METRIC_KEY,
      value: '9999',
      recordedAt: new Date(),
    })

    await checkMetricAlerts()

    const raised = await alertsForRule(rule!.id)
    expect(raised).toHaveLength(0)
  })

  it('ignoră regulile din namespace-ul accounting.* (rezervat celuilalt motor)', async () => {
    const [rule] = await db
      .insert(alertRules)
      .values({
        name: 'QA accounting namespace guard',
        metricKey: 'accounting.qa_should_be_ignored',
        condition: 'gt',
        threshold: '0',
        windowHours: 24,
        enabled: true,
      })
      .returning()
    ruleIds.push(rule!.id)

    await expect(checkMetricAlerts()).resolves.not.toThrow()
    const raised = await alertsForRule(rule!.id)
    expect(raised).toHaveLength(0)
  })

  it('evaluează mai multe reguli independent într-o singură rulare (o regulă fără date nu blochează restul)', async () => {
    const [emptyRule] = await db
      .insert(alertRules)
      .values({
        name: 'QA rule without metrics',
        metricKey: 'qa.metric_alerts_no_data',
        condition: 'gt',
        threshold: '0',
        windowHours: 24,
        enabled: true,
      })
      .returning()
    ruleIds.push(emptyRule!.id)

    const [goodRule] = await db
      .insert(alertRules)
      .values({
        name: 'QA good rule after empty',
        metricKey: METRIC_KEY,
        condition: 'lt',
        threshold: '1000',
        windowHours: 24,
        enabled: true,
        platformId,
      })
      .returning()
    ruleIds.push(goodRule!.id)

    await db.insert(platformMetrics).values({
      platformId,
      metricKey: METRIC_KEY,
      value: '1',
      recordedAt: new Date(),
    })

    await expect(checkMetricAlerts()).resolves.not.toThrow()
    expect(await alertsForRule(emptyRule!.id)).toHaveLength(0)
    expect(await alertsForRule(goodRule!.id)).toHaveLength(1)
  })
})
