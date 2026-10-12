/**
 * modules/auth/routes.ts — login (Stefan, singurul user), /me, logout. Integration test,
 * pg real + server real (app.inject).
 */
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { users, roles } from '../../shared/db/schema/index.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const TEST_EMAIL = `qa-auth-${Date.now()}@vanadium.systems`
const TEST_PASSWORD = 'qa-test-password-123'
const passwordHash = await argon2.hash(TEST_PASSWORD)
const [testUser] = await db.insert(users).values({ email: TEST_EMAIL, passwordHash, displayName: 'QA Stefan', roleId: adminRoleId }).returning()
afterAll(async () => {
  await db.delete(users).where(eq(users.id, testUser!.id))
})

function sessionCookieValue(res: { cookies: { name: string; value: string }[] }): string {
  const cookie = res.cookies.find((c) => c.name === 'vana_session')
  if (!cookie) throw new Error('vana_session cookie lipsă din răspuns')
  return cookie.value
}

const stefanLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: TEST_EMAIL, password: TEST_PASSWORD } })
const stefanCookie = sessionCookieValue(stefanLogin)

describe('POST /api/auth/login', () => {
  it('logs Stefan in on correct credentials', () => {
    expect(stefanLogin.statusCode).toBe(200)
    // Forma de sesiune (PLAN.md C2): user + rol + funcționalități. Adminul le are pe toate.
    expect(stefanLogin.json().data).toMatchObject({ user: { email: TEST_EMAIL, role: { kind: 'admin' } } })
    expect(stefanLogin.json().data.features).toContain('facturi.emitere')
  })

  it('rejects wrong credentials with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@x.com', password: 'anything' } })
    expect(res.statusCode).toBe(401)
  })

  it('rejects the former accountant login (env var ACCOUNTANT_LOGIN_PASSWORD no longer exists)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'contabila@example.com', password: process.env.ACCOUNTANT_LOGIN_PASSWORD ?? 'orice' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/auth/me', () => {
  it("returns Stefan's profile for a valid session", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { vana_session: stefanCookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.user).toMatchObject({ email: TEST_EMAIL })
  })

  it('rejects a request with no session at all (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('authenticate() — sesiune validă necesară pe rutele protejate', () => {
  it('allows a stefan session on a protected route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platforms', cookies: { vana_session: stefanCookie } })
    expect(res.statusCode).toBe(200)
  })

  it('still rejects a request with no session at all (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platforms' })
    expect(res.statusCode).toBe(401)
  })
})
