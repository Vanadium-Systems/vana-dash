/**
 * jobs/jeffbot-alerts.ts — pg real. Offline / serviciu oprit / review critic, „niciun snapshot
 * vreodată ⇒ nicio alertă" și o singură alertă per episod chiar după confirmare.
 */
import { readFileSync } from 'node:fs'
import { eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ingestSnapshot } from '../modules/jeffbot/service.js'
import type { JeffbotSnapshot } from '../modules/jeffbot/schema.js'
import { db } from '../shared/db/client.js'
import { alertRules, alerts, jeffbotEquityPoints, jeffbotReviews, jeffbotState, jeffbotTrades } from '../shared/db/schema/index.js'
import { notifyPush } from '../shared/lib/push.js'
import { checkJeffbotAlerts } from './jeffbot-alerts.js'

vi.mock('../shared/lib/push.js', () => ({ notifyPush: vi.fn(async () => {}) }))

const fixture = JSON.parse(
  readFileSync(new URL('../modules/jeffbot/fixtures/snapshot.json', import.meta.url), 'utf8'),
) as JeffbotSnapshot

async function wipe() {
  const rules = await db.select({ id: alertRules.id }).from(alertRules).where(like(alertRules.metricKey, 'jeffbot.%'))
  if (rules.length) {
    await db.delete(alerts).where(inArray(alerts.ruleId, rules.map((r) => r.id)))
    await db.delete(alertRules).where(inArray(alertRules.id, rules.map((r) => r.id)))
  }
  await db.delete(jeffbotEquityPoints)
  await db.delete(jeffbotTrades)
  await db.delete(jeffbotReviews)
  await db.delete(jeffbotState)
}

beforeEach(async () => {
  vi.mocked(notifyPush).mockClear()
  await wipe()
})
afterAll(wipe)

async function alertsFor(metricKey: string) {
  return db
    .select({ id: alerts.id, severity: alerts.severity, message: alerts.message })
    .from(alerts)
    .innerJoin(alertRules, eq(alerts.ruleId, alertRules.id))
    .where(eq(alertRules.metricKey, metricKey))
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

describe('checkJeffbotAlerts', () => {
  it('niciun snapshot vreodată ⇒ nicio alertă', async () => {
    await checkJeffbotAlerts()
    const rules = await db.select().from(alertRules).where(like(alertRules.metricKey, 'jeffbot.%'))
    expect(rules).toHaveLength(0)
  })

  it('snapshot proaspăt, totul activ ⇒ nicio alertă', async () => {
    await ingestSnapshot(fixture)
    await checkJeffbotAlerts()
    expect(await alertsFor('jeffbot.offline')).toHaveLength(0)
  })

  it('offline > 30 min ⇒ critical, o singură dată per episod chiar după confirmare', async () => {
    await ingestSnapshot(fixture)
    await db.update(jeffbotState).set({ receivedAt: minutesAgo(45) })
    await checkJeffbotAlerts()
    const [alert] = await alertsFor('jeffbot.offline')
    expect(alert).toMatchObject({ severity: 'critical' })
    expect(alert!.message).toContain('45 min')

    await db.update(alerts).set({ acknowledgedAt: new Date() }).where(eq(alerts.id, alert!.id))
    await checkJeffbotAlerts()
    expect(await alertsFor('jeffbot.offline')).toHaveLength(1)
  })

  it('serviciu oprit în snapshot proaspăt ⇒ warning', async () => {
    await ingestSnapshot({ ...fixture, services: [{ name: 'jeffbot-trader', state: 'failed' }] })
    await checkJeffbotAlerts()
    const [alert] = await alertsFor('jeffbot.service.jeffbot-trader')
    expect(alert).toMatchObject({ severity: 'warning' })
  })

  it('jeffbot-stocks oprit ⇒ link spre Assets → Bot, restul rămân pe Crypto', async () => {
    await ingestSnapshot({
      ...fixture,
      services: [
        { name: 'jeffbot-trader', state: 'failed' },
        { name: 'jeffbot-stocks', state: 'failed' },
      ],
    })
    await checkJeffbotAlerts()
    const payloads = vi.mocked(notifyPush).mock.calls.map(([, content]) => (typeof content === 'function' ? content('ro') : content))
    const urlFor = (service: string) => payloads.find((payload) => payload.body.includes(service))?.url
    expect(urlFor('jeffbot-stocks')).toBe('/assets?tab=bot')
    expect(urlFor('jeffbot-trader')).toBe('/crypto?tab=bot')
  })

  it('serviciu oprit dar snapshot vechi ⇒ doar offline, nu și serviciul', async () => {
    await ingestSnapshot({ ...fixture, services: [{ name: 'jeffbot-trader', state: 'failed' }] })
    await db.update(jeffbotState).set({ receivedAt: minutesAgo(20) })
    await checkJeffbotAlerts()
    expect(await alertsFor('jeffbot.service.jeffbot-trader')).toHaveLength(0)
    expect(await alertsFor('jeffbot.offline')).toHaveLength(0)
  })

  it('ultimul review critical ⇒ critical cu summary; review nou critic ⇒ alertă nouă', async () => {
    const critical = { ...fixture.reviews[0]!, severity: 'critical' as const, summary: 'Traderul a căzut de 3 ori.' }
    await ingestSnapshot({ ...fixture, reviews: [critical] })
    await checkJeffbotAlerts()
    const [alert] = await alertsFor('jeffbot.review.critical')
    expect(alert!.message).toContain('Traderul a căzut de 3 ori.')

    await db.update(alerts).set({ acknowledgedAt: new Date() }).where(eq(alerts.id, alert!.id))
    await checkJeffbotAlerts()
    expect(await alertsFor('jeffbot.review.critical')).toHaveLength(1)

    await ingestSnapshot({ ...fixture, reviews: [{ ...critical, date: '2026-09-26', summary: 'Din nou.' }] })
    await checkJeffbotAlerts()
    expect(await alertsFor('jeffbot.review.critical')).toHaveLength(2)
  })
})
