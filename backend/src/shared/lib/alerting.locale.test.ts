/**
 * An alert raised by a job has no reader yet: the row is stored in the installation's
 * language, and each person's phone gets it in their own. Integration test on the real
 * database, with the FCM sender replaced.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../db/client.js'
import { alertRules, alerts, deviceTokens, users } from '../db/schema/index.js'

vi.mock('./email.js', () => ({ sendAlertEmail: vi.fn(async () => {}), sendEmail: vi.fn(async () => {}) }))

const { ensureAlertRule, raiseAlert } = await import('./alerting.js')
const { tl } = await import('./i18n.js')
const { setFcmSenderForTests, setPushPreferences } = await import('./push.js')

const stamp = Date.now()
const RULE_KEY = `qa.locale.${stamp}`
const sent: Array<{ tokens: string[]; title: string; body: string }> = []
let people: Array<{ id: string }> = []
let ruleId = ''

beforeAll(async () => {
  await setPushPreferences({ alerts: true })
  people = await db
    .insert(users)
    .values([
      { email: `qa-alert-ro-${stamp}@example.com`, passwordHash: 'x', locale: 'ro' },
      { email: `qa-alert-en-${stamp}@example.com`, passwordHash: 'x', locale: 'en' },
    ])
    .returning({ id: users.id })
  await db.insert(deviceTokens).values([
    { token: `qa-alert-ro-${stamp}`, ownerUserId: people[0]!.id },
    { token: `qa-alert-en-${stamp}`, ownerUserId: people[1]!.id },
  ])
  setFcmSenderForTests(async (tokens, payload) => {
    sent.push({ tokens, title: payload.title, body: payload.body })
    return []
  })
  ruleId = await ensureAlertRule(RULE_KEY, 'QA locale')
})

afterAll(async () => {
  setFcmSenderForTests(null)
  await db.delete(alerts).where(eq(alerts.ruleId, ruleId))
  await db.delete(alertRules).where(eq(alertRules.id, ruleId))
  await db.delete(users).where(inArray(users.id, people.map((person) => person.id)))
})

describe('an alert sent to people with different languages', () => {
  it('goes out once per language, and is stored in the installation default', async () => {
    await raiseAlert(ruleId, tl('alerts.jobs.botSilent', { minutes: 7 }), { email: false })
    const mine = () => sent.filter((call) => call.tokens.some((token) => token.endsWith(String(stamp))))
    await vi.waitFor(() => expect(mine().length).toBeGreaterThanOrEqual(2))

    const forToken = (token: string) => mine().find((call) => call.tokens.includes(token))
    expect(forToken(`qa-alert-ro-${stamp}`)).toMatchObject({ title: 'Alertă vana-dash', body: 'Botul nu mai trimite date de 7 min' })
    expect(forToken(`qa-alert-en-${stamp}`)).toMatchObject({ title: 'VanaDash alert', body: 'The bot has not sent data for 7 min' })

    const [stored] = await db.select({ message: alerts.message }).from(alerts).where(eq(alerts.ruleId, ruleId))
    expect(stored?.message).toBe('Botul nu mai trimite date de 7 min')
  })
})
