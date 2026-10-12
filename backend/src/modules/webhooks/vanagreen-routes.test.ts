/**
 * POST /api/webhooks/vanagreen-alert — verifică doar GRANIȚA rutei (token lipsă/greșit/
 * neconfigurat); conținutul alertei are propriile teste în vanagreen-service.test.ts.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { alertRules, alerts } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const TEST_TOKEN = 'qa-test-vanagreen-ingest-token'

function samplePayload(invoiceId: string) {
  return {
    source: 'send_error' as const,
    tenant_id: 'qa-route-tenant',
    tenant_name: 'QA Route Tenant',
    invoice_id: invoiceId,
    invoice_number: null,
    company_name: null,
    company_cui: null,
    error_code: null,
    error_message: 'eroare de test',
    url: 'https://recycle.vanadium.systems',
  }
}

describe('POST /api/webhooks/vanagreen-alert — auth fail-closed', () => {
  it('respinge cu 401 dacă VANAGREEN_ALERT_INGEST_TOKEN nu e configurat', async () => {
    const original = config.vanagreenAlertIngestToken
    config.vanagreenAlertIngestToken = ''
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/vanagreen-alert',
        headers: { 'x-ingest-token': 'anything' },
        payload: samplePayload('qa-route-1'),
      })
      expect(res.statusCode).toBe(401)
    } finally {
      config.vanagreenAlertIngestToken = original
    }
  })

  it('respinge cu 401 pt. un token greșit', async () => {
    const original = config.vanagreenAlertIngestToken
    config.vanagreenAlertIngestToken = TEST_TOKEN
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/vanagreen-alert',
        headers: { 'x-ingest-token': 'not-the-real-token' },
        payload: samplePayload('qa-route-2'),
      })
      expect(res.statusCode).toBe(401)
    } finally {
      config.vanagreenAlertIngestToken = original
    }
  })

  it('acceptă (200) un token valid și creează o alertă', async () => {
    const original = config.vanagreenAlertIngestToken
    config.vanagreenAlertIngestToken = TEST_TOKEN
    const invoiceId = `qa-route-${Date.now()}`
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/vanagreen-alert',
        headers: { 'x-ingest-token': TEST_TOKEN },
        payload: samplePayload(invoiceId),
      })
      expect(res.statusCode).toBe(200)

      const [rule] = await db
        .select()
        .from(alertRules)
        .where(eq(alertRules.metricKey, `vanagreen.efactura.qa-route-tenant.${invoiceId}.send_error`))
      expect(rule).toBeDefined()

      await db.delete(alerts).where(inArray(alerts.ruleId, [rule!.id]))
      await db.delete(alertRules).where(inArray(alertRules.id, [rule!.id]))
    } finally {
      config.vanagreenAlertIngestToken = original
    }
  })
})
