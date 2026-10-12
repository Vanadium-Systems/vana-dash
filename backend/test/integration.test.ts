/**
 * Integration tests — rulează pe Postgres-ul de dev (infra/docker-compose.yml).
 * Precondiție: `docker compose -f infra/docker-compose.yml up -d postgres`
 * și `pnpm db:migrate`.
 */
import argon2 from 'argon2'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from '../src/app.js'
import { db, sql } from '../src/shared/db/client.js'
import { platformMetrics, platforms, roles, syncLog, users } from '../src/shared/db/schema/index.js'
import { runConnectorSync, upsertMetrics } from '../src/shared/lib/sync.js'
import { adminRoleId } from './helpers.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const TEST_EMAIL = `test-${Date.now()}@test.local`
const TEST_PASSWORD = 'parola-de-test-123'

let app: Awaited<ReturnType<typeof buildServer>>
let cookie = ''

beforeAll(async () => {
  await db.insert(users).values({
    email: TEST_EMAIL,
    passwordHash: await argon2.hash(TEST_PASSWORD),
    displayName: 'Test',
    roleId: adminRoleId,
  })
  app = await buildServer()
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL))
  // CRUD-ul face doar soft delete — curățăm hard ca să nu se acumuleze în DB-ul de dev
  await db.delete(platforms).where(eq(platforms.name, 'Test VanaGreen'))
  await app.close()
  await sql.end()
})

describe('auth flow', () => {
  it('rejects unauthenticated access to protected routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platforms' })
    expect(res.statusCode).toBe(401)
  })

  it('leaves /health open', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })

  it('rejects wrong credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: TEST_EMAIL, password: 'gresit-total-123' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('logs in with valid credentials and sets HttpOnly cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    const setCookie = res.headers['set-cookie']
    expect(setCookie).toBeDefined()
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : setCookie!
    expect(cookieStr).toContain('HttpOnly')
    cookie = cookieStr.split(';')[0]!
  })

  it('returns the user on /api/auth/me with the cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.user.email).toBe(TEST_EMAIL)
  })
})

describe('platforms CRUD', () => {
  let platformId = ''

  it('creates a platform without ever returning the api key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/platforms',
      headers: { cookie },
      payload: {
        name: 'Test VanaGreen',
        // URL public — doar formatul HTTP contează aici (SSRF guard blochează loopback/privat
        // la creare, vezi shared/lib/ssrf-guard.ts), nu accesibilitatea reală. Testele de sync
        // de mai jos folosesc un platformId separat, inserat direct în DB (bypass validare HTTP),
        // exact ca describe('metric upsert') mai jos — ca să păstreze eșecul de conexiune rapid
        // și determinist (port local închis), fără să reintroducă un URL blocat de SSRF guard.
        type: 'vanagreen',
        apiUrl: 'https://vanagreen.example.com',
        apiKey: 'super-secret-key',
        syncCron: '*/30 * * * *',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.body
    expect(body).not.toContain('super-secret-key')
    expect(body).not.toContain('apiKeyEnc')
    platformId = res.json().data.id
  })

  it('rejects unknown platform types', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/platforms',
      headers: { cookie },
      payload: {
        name: 'X',
        type: 'nonexistent',
        apiUrl: 'http://example.com',
        apiKey: 'k',
        syncCron: '* * * * *',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a platform URL pointing at loopback/private ranges (SSRF guard)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/platforms',
      headers: { cookie },
      payload: {
        name: 'SSRF attempt',
        type: 'vanagreen',
        apiUrl: 'http://127.0.0.1:59999',
        apiKey: 'k',
        syncCron: '* * * * *',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('lists platforms without leaking the encrypted key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platforms', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('apiKeyEnc')
    expect(res.body).not.toContain('super-secret-key')
  })

  it('isolates a failing connector: sync logs FAILED, request succeeds', async () => {
    // Platformă inserată direct în DB (bypass schema HTTP/SSRF guard, ca la 'metric upsert' mai
    // jos) — apiUrl arată spre un port închis → fetch-ul pică rapid și determinist →
    // runConnectorSync prinde. SSRF guard-ul blochează doar la CREARE prin API, nu retroactiv
    // pe rânduri deja existente — un test unitar separat (rejects a platform URL...) acoperă gate-ul.
    const [failingPlatform] = await db
      .insert(platforms)
      .values({
        name: 'Test VanaGreen Failing Sync',
        type: 'vanagreen',
        apiUrl: 'http://127.0.0.1:59999',
        apiKeyEnc: 'irrelevant',
      })
      .returning({ id: platforms.id })
    const failingPlatformId = failingPlatform!.id

    const res = await app.inject({
      method: 'POST',
      url: `/api/platforms/${failingPlatformId}/sync`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)

    const [entry] = await db
      .select()
      .from(syncLog)
      .where(and(eq(syncLog.platformId, failingPlatformId), eq(syncLog.status, 'FAILED')))
    expect(entry).toBeDefined()
    expect(entry!.errorMessage).toBeTruthy()
    // Cheia nu apare în mesajul de eroare
    expect(entry!.errorMessage).not.toContain('super-secret-key')

    await db.delete(platforms).where(eq(platforms.id, failingPlatformId))
  })

  it('soft-deletes the platform', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/platforms/${platformId}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/api/platforms', headers: { cookie } })
    const ids = list.json().data.map((p: { id: string }) => p.id)
    expect(ids).not.toContain(platformId)
  })
})

describe('metric upsert', () => {
  let platformId = ''

  beforeAll(async () => {
    const [row] = await db
      .insert(platforms)
      .values({
        name: 'Upsert Test',
        type: 'vanagreen',
        apiUrl: 'http://127.0.0.1:59999',
        apiKeyEnc: 'irrelevant',
      })
      .returning({ id: platforms.id })
    platformId = row!.id
  })

  afterAll(async () => {
    await db.delete(platforms).where(eq(platforms.id, platformId))
  })

  it('running the same sync twice produces one row per (key, day), updated in place', async () => {
    const recordedAt = new Date(2026, 6, 4)
    await upsertMetrics(platformId, [{ metricKey: 'revenue', value: 100, unit: 'RON', recordedAt }])
    await upsertMetrics(platformId, [{ metricKey: 'revenue', value: 250, unit: 'RON', recordedAt }])

    const rows = await db
      .select()
      .from(platformMetrics)
      .where(and(eq(platformMetrics.platformId, platformId), eq(platformMetrics.metricKey, 'revenue')))
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.value)).toBe(250)
  })

  it('runConnectorSync never throws even when the connector is broken', async () => {
    const [platform] = await db.select().from(platforms).where(eq(platforms.id, platformId))
    // apiKeyEnc invalid + URL mort — ambele ar arunca; verificăm izolarea
    await expect(runConnectorSync(platform!)).resolves.toBeUndefined()
    const [entry] = await db
      .select()
      .from(syncLog)
      .where(and(eq(syncLog.platformId, platformId), eq(syncLog.status, 'FAILED')))
    expect(entry).toBeDefined()
  })
})
