/**
 * Integration test — pg real (test/setup.ts) + un mic server HTTP local ca stand-in pt.
 * endpoint-ul vanagreen (nu lovim recyclers_app real). Verifică: semnal roșu → alertă,
 * platformă nefetch-abilă → alertă „nu răspunde", connector fără fetchOpsSignals → ignorat,
 * dedup (nu re-emite cât timp alerta e activă) + failure izolat per platformă (regula #7).
 */
import { createServer, type Server } from 'node:http'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db } from '../shared/db/client.js'
import { alertRules, alerts, platforms } from '../shared/db/schema/index.js'
import { encryptApiKey } from '../shared/lib/crypto.js'
import { checkPlatformOpsAlerts } from './platform-ops-alerts.js'

const platformIds: string[] = []
let server: Server | null = null
let serverUrl = ''

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
})

afterAll(async () => {
  if (platformIds.length) {
    await db.delete(alerts).where(inArray(alerts.ruleId, await ruleIdsForPlatforms()))
    await db.delete(alertRules).where(inArray(alertRules.metricKey, await metricKeysForPlatforms()))
    await db.delete(platforms).where(inArray(platforms.id, platformIds))
  }
})

async function ruleIdsForPlatforms() {
  const rows = await db.select({ id: alertRules.id }).from(alertRules).where(inArray(alertRules.metricKey, await metricKeysForPlatforms()))
  return rows.map((r) => r.id)
}
async function metricKeysForPlatforms() {
  return platformIds.flatMap((id) => [`platform_ops.${id}.unreachable`, `platform_ops.${id}.cpu`])
}

async function createPlatform(apiUrl: string) {
  const [row] = await db
    .insert(platforms)
    .values({ name: `QA ops-alerts ${Date.now()}`, type: 'vanagreen', apiUrl, apiKeyEnc: encryptApiKey('qa-fake-key') })
    .returning()
  platformIds.push(row!.id)
  return row!
}

function startFakeVanagreen(signalLevel: 'red' | 'green'): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      if (req.url === '/api/v1/platform/health-signals') {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            generated_at: new Date().toISOString(),
            signals: [
              { key: 'cpu', label: 'CPU host', level: signalLevel, value: 12, unit: 'pct', detail: `CPU ${signalLevel}` },
            ],
            history: [],
          }),
        )
        return
      }
      res.statusCode = 404
      res.end()
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

async function alertsForKey(platformId: string, suffix: string) {
  const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, `platform_ops.${platformId}.${suffix}`))
  if (!rule) return []
  return db.select().from(alerts).where(eq(alerts.ruleId, rule.id))
}

describe('checkPlatformOpsAlerts', () => {
  it('declanșează alertă critică pt. un semnal roșu', async () => {
    serverUrl = await startFakeVanagreen('red')
    const platform = await createPlatform(serverUrl)

    await checkPlatformOpsAlerts()

    const raised = await alertsForKey(platform.id, 'cpu')
    expect(raised).toHaveLength(1)
    expect(raised[0]?.severity).toBe('critical')
    expect(raised[0]?.message).toContain('CPU host')
  })

  it('nu declanșează nimic pt. semnale non-roșii', async () => {
    serverUrl = await startFakeVanagreen('green')
    const platform = await createPlatform(serverUrl)

    await checkPlatformOpsAlerts()

    expect(await alertsForKey(platform.id, 'cpu')).toHaveLength(0)
  })

  it('nu re-emite cât timp alerta anterioară e încă activă (dedup)', async () => {
    serverUrl = await startFakeVanagreen('red')
    const platform = await createPlatform(serverUrl)

    await checkPlatformOpsAlerts()
    await checkPlatformOpsAlerts()

    expect(await alertsForKey(platform.id, 'cpu')).toHaveLength(1)
  })

  it('declanșează alertă „nu răspunde" pt. o platformă nefetch-abilă, fără să oprească restul', async () => {
    const unreachable = await createPlatform('http://127.0.0.1:1')
    serverUrl = await startFakeVanagreen('red')
    const reachable = await createPlatform(serverUrl)

    await expect(checkPlatformOpsAlerts()).resolves.not.toThrow()

    const unreachableAlerts = await alertsForKey(unreachable.id, 'unreachable')
    expect(unreachableAlerts).toHaveLength(1)
    expect(unreachableAlerts[0]?.message).toContain('nu răspunde')

    expect(await alertsForKey(reachable.id, 'cpu')).toHaveLength(1)
  })

  it('ignoră o platformă al cărei connector nu implementează fetchOpsSignals', async () => {
    const [row] = await db
      .insert(platforms)
      .values({ name: 'QA unsupported connector', type: 'nu-exista-asa-ceva', apiUrl: 'http://127.0.0.1:1', apiKeyEnc: encryptApiKey('x') })
      .returning()
    platformIds.push(row!.id)

    await expect(checkPlatformOpsAlerts()).resolves.not.toThrow()
    const rules = await db
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.metricKey, `platform_ops.${row!.id}.unreachable`), isNull(alertRules.deletedAt)))
    expect(rules).toHaveLength(0)
  })
})
