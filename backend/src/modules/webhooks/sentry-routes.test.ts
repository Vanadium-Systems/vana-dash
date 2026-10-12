/**
 * POST /api/webhooks/sentry — verifică doar GRANIȚA rutei (semnătură HMAC lipsă/greșită/
 * neconfigurată, ca inbound-routes.test.ts pt. webhook-ul Resend); extracția/dedup au propriile
 * teste exhaustive în sentry-service.test.ts.
 */
import { createHmac } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { alertRules, alerts } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const TEST_SECRET = 'qa-test-sentry-webhook-secret'

function sign(body: string): string {
  return createHmac('sha256', TEST_SECRET).update(body).digest('hex')
}

describe('POST /api/webhooks/sentry — auth fail-closed', () => {
  it('respinge cu 503 dacă SENTRY_WEBHOOK_SECRET nu e configurat', async () => {
    const original = config.sentryWebhookSecret
    config.sentryWebhookSecret = ''
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/sentry',
        headers: { 'content-type': 'application/json', 'sentry-hook-signature': 'anything' },
        payload: '{}',
      })
      expect(res.statusCode).toBe(503)
    } finally {
      config.sentryWebhookSecret = original
    }
  })

  it('respinge cu 400 dacă header-ul Sentry-Hook-Signature lipsește', async () => {
    const original = config.sentryWebhookSecret
    config.sentryWebhookSecret = TEST_SECRET
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/sentry',
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      })
      expect(res.statusCode).toBe(400)
    } finally {
      config.sentryWebhookSecret = original
    }
  })

  it('respinge cu 401 pt. o semnătură greșită', async () => {
    const original = config.sentryWebhookSecret
    config.sentryWebhookSecret = TEST_SECRET
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/sentry',
        headers: { 'content-type': 'application/json', 'sentry-hook-signature': 'not-the-real-signature' },
        payload: '{}',
      })
      expect(res.statusCode).toBe(401)
    } finally {
      config.sentryWebhookSecret = original
    }
  })

  it('acceptă (200) o semnătură validă și creează o alertă', async () => {
    const original = config.sentryWebhookSecret
    config.sentryWebhookSecret = TEST_SECRET
    const issueId = `qa-route-${Date.now()}`
    const body = JSON.stringify({ data: { issue: { id: issueId, title: 'QA route issue', level: 'error' } } })
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/sentry',
        headers: { 'content-type': 'application/json', 'sentry-hook-signature': sign(body) },
        payload: body,
      })
      expect(res.statusCode).toBe(200)

      const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, `sentry.${issueId}`))
      expect(rule).toBeTruthy()
      await db.delete(alerts).where(inArray(alerts.ruleId, [rule!.id]))
      await db.delete(alertRules).where(inArray(alertRules.id, [rule!.id]))
    } finally {
      config.sentryWebhookSecret = original
    }
  })
})
