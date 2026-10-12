/**
 * Integration test — pg real (test/setup.ts) + un mic server HTTP local ca stand-in pt.
 * o platformă vanagreen (nu lovim recyclers_app real). Verifică: site jos → alertă,
 * backend degradat (checkHealth non-'healthy') → alertă, dedup, izolare per platformă.
 */
import { createServer, type Server } from 'node:http'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db } from '../shared/db/client.js'
import { alertRules, alerts, platforms } from '../shared/db/schema/index.js'
import { encryptApiKey } from '../shared/lib/crypto.js'
import { checkUptime } from './uptime-monitor.js'

const platformIds: string[] = []
let server: Server | null = null

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
})

afterAll(async () => {
  if (platformIds.length) {
    const keys = platformIds.flatMap((id) => [`platform_uptime.${id}.site`, `platform_uptime.${id}.backend`])
    const rules = await db.select({ id: alertRules.id }).from(alertRules).where(inArray(alertRules.metricKey, keys))
    if (rules.length) await db.delete(alerts).where(inArray(alerts.ruleId, rules.map((r) => r.id)))
    await db.delete(alertRules).where(inArray(alertRules.metricKey, keys))
    await db.delete(platforms).where(inArray(platforms.id, platformIds))
  }
})

async function createPlatform(apiUrl: string) {
  const [row] = await db
    .insert(platforms)
    .values({ name: `QA uptime ${Date.now()}`, type: 'vanagreen', apiUrl, apiKeyEnc: encryptApiKey('qa-fake-key') })
    .returning()
  platformIds.push(row!.id)
  return row!
}

/** healthStatusCode: status code pt. GET /health (200 = healthy, 503 = db jos → 'degraded'). rootStatusCode: status code pt. root (site). */
function startFakeVanagreen(rootStatusCode: number, healthStatusCode: number): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.statusCode = healthStatusCode
        res.end(JSON.stringify({ status: healthStatusCode === 200 ? 'ok' : 'degraded' }))
        return
      }
      res.statusCode = rootStatusCode
      res.end('ok')
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

async function alertsForKey(platformId: string, suffix: 'site' | 'backend') {
  const [rule] = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.metricKey, `platform_uptime.${platformId}.${suffix}`), isNull(alertRules.deletedAt)))
  if (!rule) return []
  return db.select().from(alerts).where(eq(alerts.ruleId, rule.id))
}

describe('checkUptime', () => {
  it('nu alertează dacă site + backend răspund OK', async () => {
    const url = await startFakeVanagreen(200, 200)
    const platform = await createPlatform(url)

    await checkUptime()

    expect(await alertsForKey(platform.id, 'site')).toHaveLength(0)
    expect(await alertsForKey(platform.id, 'backend')).toHaveLength(0)
  })

  it('alertează dacă site-ul nu răspunde (platformă nefetch-abilă)', async () => {
    const platform = await createPlatform('http://127.0.0.1:1')

    await checkUptime()

    const raised = await alertsForKey(platform.id, 'site')
    expect(raised).toHaveLength(1)
    expect(raised[0]?.severity).toBe('critical')
  })

  it('alertează dacă backend/DB e degradat (GET /health → 503) chiar dacă site-ul răspunde', async () => {
    const url = await startFakeVanagreen(200, 503)
    const platform = await createPlatform(url)

    await checkUptime()

    expect(await alertsForKey(platform.id, 'site')).toHaveLength(0)
    const raised = await alertsForKey(platform.id, 'backend')
    expect(raised).toHaveLength(1)
    expect(raised[0]?.message).toContain('backend')
    expect(raised[0]?.severity).toBe('critical')
  })

  it('nu re-emite cât timp alerta anterioară e încă activă (dedup)', async () => {
    const platform = await createPlatform('http://127.0.0.1:1')

    await checkUptime()
    await checkUptime()

    expect(await alertsForKey(platform.id, 'site')).toHaveLength(1)
  })

  it('izolează eșecul unei platforme — restul tot se verifică', async () => {
    const broken = await createPlatform('http://127.0.0.1:1')
    const url = await startFakeVanagreen(200, 200)
    const healthy = await createPlatform(url)

    await expect(checkUptime()).resolves.not.toThrow()

    expect(await alertsForKey(broken.id, 'site')).toHaveLength(1)
    expect(await alertsForKey(healthy.id, 'site')).toHaveLength(0)
  })
})
