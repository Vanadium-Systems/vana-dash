/**
 * GET /api/platforms/:id/ops-signals (Feature 2, PLAN.md 2026-07-25) — verifică granița rutei:
 * 404 platformă inexistentă, 200 supported:false pt. connector fără fetchOpsSignals, 502 pe
 * eroare de rețea. NU lovește recyclers_app real — folosește un apiUrl neaccesibil local pt.
 * cazul 502 (ECONNREFUSED e suficient de rapid, nu așteaptă timeout-ul de 15s).
 */
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { platforms, users, roles } from '../../shared/db/schema/index.js'
import { encryptApiKey } from '../../shared/lib/crypto.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const TEST_EMAIL = `qa-ops-signals-${Date.now()}@vanadium.systems`
const TEST_PASSWORD = 'qa-test-password-123'
const passwordHash = await argon2.hash(TEST_PASSWORD)
const [testUser] = await db.insert(users).values({ email: TEST_EMAIL, passwordHash, displayName: 'QA Stefan', roleId: adminRoleId }).returning()

const platformIds: string[] = []
afterAll(async () => {
  if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds))
  await db.delete(users).where(eq(users.id, testUser!.id))
})

const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: TEST_EMAIL, password: TEST_PASSWORD } })
const cookie = login.cookies.find((c) => c.name === 'vana_session')!.value

describe('GET /api/platforms/:id/ops-signals', () => {
  it('întoarce 404 pt. o platformă inexistentă', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platforms/00000000-0000-0000-0000-000000000000/ops-signals',
      cookies: { vana_session: cookie },
    })
    expect(res.statusCode).toBe(404)
  })

  it('întoarce supported:false pt. un connector care nu implementează fetchOpsSignals', async () => {
    const [platform] = await db
      .insert(platforms)
      .values({
        name: 'QA no-ops-signals',
        type: 'nu-exista-un-asa-connector',
        apiUrl: 'http://127.0.0.1:1',
        apiKeyEnc: encryptApiKey('fake-key'),
      })
      .returning()
    platformIds.push(platform!.id)

    const res = await app.inject({
      method: 'GET',
      url: `/api/platforms/${platform!.id}/ops-signals`,
      cookies: { vana_session: cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ supported: false, signals: [], history: [] })
  })

  it('întoarce 502 când connectorul există dar fetch-ul eșuează (platforma jos/endpoint lipsă)', async () => {
    const [platform] = await db
      .insert(platforms)
      .values({
        name: 'QA vanagreen unreachable',
        type: 'vanagreen',
        apiUrl: 'http://127.0.0.1:1',
        apiKeyEnc: encryptApiKey('fake-key'),
      })
      .returning()
    platformIds.push(platform!.id)

    const res = await app.inject({
      method: 'GET',
      url: `/api/platforms/${platform!.id}/ops-signals`,
      cookies: { vana_session: cookie },
    })
    expect(res.statusCode).toBe(502)
  })

  it('respinge lipsa oricărei sesiuni cu 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platforms/00000000-0000-0000-0000-000000000000/ops-signals' })
    expect(res.statusCode).toBe(401)
  })
})
