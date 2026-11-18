/**
 * Bearer branch of `authenticate`: token states, the feature intersection, paths refused to tokens,
 * history attribution, the per-token rate limit and the route catalogue a token sees.
 */
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../db/client.js'
import { apiTokens, auditLog, prospects, roles, users } from '../db/schema/index.js'
import { sessionToken } from '../testing/session-token.js'

const app = await buildServer()
await app.ready()

const passwordHash = await argon2.hash('parola-de-test-123')
const stamp = Date.now()
const userIds: string[] = []
const roleIds: string[] = []
const prospectIds: string[] = []

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select().from(users).where(eq(users.roleId, adminRole!.id)).limit(1)
const adminCookie = await sessionToken(app, adminUser!.id, adminUser!.sessionVersion)

async function createPerson(label: string, features: string[]) {
  const [role] = await db.insert(roles).values({ name: `QA token auth ${label}: ${stamp}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [person] = await db
    .insert(users)
    .values({ email: `qa-tokauth-${label}-${stamp}@example.com`, passwordHash, displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(person!.id)
  return { person: person!, role: role!, cookie: await sessionToken(app, person!.id, person!.sessionVersion) }
}

const FEATURES = ['clienti.view', 'clienti.prospectare', 'echipa.tokenuri']

afterAll(async () => {
  const tokenIds = (await db.select({ id: apiTokens.id }).from(apiTokens).where(inArray(apiTokens.userId, userIds))).map((row) => row.id)
  if (prospectIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
  if (tokenIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, tokenIds))
  await db.delete(apiTokens).where(inArray(apiTokens.userId, userIds))
  await db.delete(auditLog).where(inArray(auditLog.entityId, userIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

const asCookie = (method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, cookie: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: { vana_session: cookie }, payload })

const asToken = (method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, token: string, payload?: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, payload })

async function mint(owner: { cookie: string }, name: string, features?: string[]) {
  const res = await asCookie('POST', '/api/me/api-tokens', owner.cookie, features ? { name, features } : { name })
  expect(res.statusCode).toBe(201)
  return res.json().data as { token: string; item: { id: string } }
}

describe('api token auth', () => {
  it('a view-only token reads prospects but cannot create one', async () => {
    const owner = await createPerson('subset', FEATURES)
    const { token } = await mint(owner, 'view-only', ['clienti.view'])

    expect((await asToken('GET', '/api/prospects', token)).statusCode).toBe(200)
    const created = await asToken('POST', '/api/prospects', token, { name: 'Acme QA' })
    expect(created.statusCode).toBe(403)
    expect(created.json().error).toMatchObject({ code: 'FEATURE_FORBIDDEN', feature: 'clienti.prospectare' })
  })

  it('a token with a write feature ticked writes, and the history names the token', async () => {
    const owner = await createPerson('full', FEATURES)
    const { token, item } = await mint(owner, 'full-access', ['clienti.view', 'clienti.prospectare'])

    const created = await asToken('POST', '/api/prospects', token, { name: 'Acme QA' })
    expect([200, 201]).toContain(created.statusCode)
    const prospectId: string = created.json().data.id
    prospectIds.push(prospectId)

    const [row] = await db.select().from(auditLog).where(eq(auditLog.entityId, prospectId))
    expect(row!.action).toBe('prospect.creat')
    expect(row!.apiTokenId).toBe(item.id)

    const history = await asCookie('GET', `/api/audit?entityId=${prospectId}`, adminCookie)
    expect(history.statusCode).toBe(200)
    expect(history.json().data[0].viaToken).toEqual({ id: item.id, name: 'full-access' })
  })

  it('paths refused to tokens answer 403 TOKEN_NOT_ALLOWED', async () => {
    const owner = await createPerson('denied', FEATURES)
    const { token } = await mint(owner, 'denied')

    for (const [method, url] of [
      ['GET', '/api/me/api-tokens'],
      ['POST', '/api/team/members'],
      ['PATCH', '/api/auth/me'],
      ['GET', '/api/access/matrix'],
    ] as const) {
      const res = await asToken(method, url, token, method === 'GET' ? undefined : {})
      expect(res.statusCode, `${method} ${url}`).toBe(403)
      expect(res.json().error.code, `${method} ${url}`).toBe('TOKEN_NOT_ALLOWED')
    }
  })

  it('GET /api/auth/me through a token shows the intersection', async () => {
    const owner = await createPerson('intersect', FEATURES)
    const { token } = await mint(owner, 'narrow', ['clienti.view'])
    const me = await asToken('GET', '/api/auth/me', token)
    expect(me.statusCode).toBe(200)
    expect(me.json().data.features).toEqual(['clienti.view'])
  })

  it('a revoked token is 401 TOKEN_INVALID', async () => {
    const owner = await createPerson('revoked', FEATURES)
    const { token, item } = await mint(owner, 'to-revoke')
    expect((await asCookie('DELETE', `/api/me/api-tokens/${item.id}`, owner.cookie)).statusCode).toBe(200)
    const res = await asToken('GET', '/api/auth/me', token)
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('TOKEN_INVALID')
  })

  it('an expired token is 401', async () => {
    const owner = await createPerson('expired', FEATURES)
    const { token, item } = await mint(owner, 'to-expire')
    await db.update(apiTokens).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(apiTokens.id, item.id))
    const res = await asToken('GET', '/api/auth/me', token)
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('TOKEN_INVALID')
  })

  it('disabling the person kills the token and sets revoked_at', async () => {
    const owner = await createPerson('disabled', FEATURES)
    const { token, item } = await mint(owner, 'doomed')
    expect((await asToken('GET', '/api/auth/me', token)).statusCode).toBe(200)

    const disabled = await asCookie('PATCH', `/api/team/members/${owner.person.id}`, adminCookie, { status: 'disabled' })
    expect(disabled.statusCode).toBe(200)
    expect((await asToken('GET', '/api/auth/me', token)).statusCode).toBe(401)
    const [stored] = await db.select().from(apiTokens).where(eq(apiTokens.id, item.id))
    expect(stored!.revokedAt).not.toBeNull()
  })

  it('shrinking the role takes the page away from a token without a subset', async () => {
    const owner = await createPerson('shrink', FEATURES)
    const { token } = await mint(owner, 'shrinking')
    expect((await asToken('GET', '/api/prospects', token)).statusCode).toBe(200)

    await db.update(roles).set({ features: ['echipa.tokenuri'] }).where(eq(roles.id, owner.role.id))
    const res = await asToken('GET', '/api/prospects', token)
    expect(res.statusCode).toBe(403)
    // Without the page gate, the page's write feature goes too.
    const write = await asToken('POST', '/api/prospects', token, { name: 'Acme QA' })
    expect(write.statusCode).toBe(403)
  })

  it('changing the password revokes the tokens; a bare session_version bump does not', async () => {
    const owner = await createPerson('session', FEATURES)
    const { token: survivor } = await mint(owner, 'survivor')
    // Logging out other devices without a password change (session_version only) keeps tokens.
    await db.update(users).set({ sessionVersion: owner.person.sessionVersion + 1 }).where(eq(users.id, owner.person.id))
    expect((await asToken('GET', '/api/auth/me', survivor)).statusCode).toBe(200)

    const fresh = await sessionToken(app, owner.person.id, owner.person.sessionVersion + 1)
    const res = await asCookie('POST', '/api/auth/me/password', fresh, {
      currentPassword: 'parola-de-test-123',
      newPassword: 'o-parola-noua-destul-de-lunga-42',
    })
    expect(res.statusCode).toBe(200)
    const after = await asToken('GET', '/api/auth/me', survivor)
    expect(after.statusCode).toBe(401)
    expect(after.json().error.code).toBe('TOKEN_INVALID')
  })

  it('an admin password reset revokes the person\'s tokens', async () => {
    const owner = await createPerson('reset', FEATURES)
    const { token, item } = await mint(owner, 'to be reset')
    const res = await asCookie('POST', `/api/team/members/${owner.person.id}/reset-password`, adminCookie)
    expect(res.statusCode).toBe(200)
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, item.id))
    expect(row!.revokedAt).not.toBeNull()
    expect((await asToken('GET', '/api/auth/me', token)).statusCode).toBe(401)
  })

  it('x-tenant-id with a token is refused', async () => {
    const owner = await createPerson('tenant', FEATURES)
    const { token } = await mint(owner, 'tenant')
    const res = await asToken('GET', '/api/auth/me', token, undefined, { 'x-tenant-id': '00000000-0000-4000-8000-000000000000' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('TOKEN_NOT_ALLOWED')
  })

  it('a Bearer that is not a known token is 401 TOKEN_INVALID, with no fallback to the cookie', async () => {
    const owner = await createPerson('garbage', FEATURES)
    for (const value of ['xyz', 'vd_unknown']) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${value}` },
        cookies: { vana_session: owner.cookie },
      })
      expect(res.statusCode, value).toBe(401)
      expect(res.json().error.code, value).toBe('TOKEN_INVALID')
    }
  })

  it('a token is limited to 120 requests a minute, apart from the cookie bucket', async () => {
    const owner = await createPerson('limit', FEATURES)
    const { token } = await mint(owner, 'limited')
    for (let i = 0; i < 120; i++) {
      const res = await asToken('GET', '/api/auth/me', token)
      expect(res.statusCode, `request ${i + 1}`).toBe(200)
    }
    expect((await asToken('GET', '/api/auth/me', token)).statusCode).toBe(429)
    expect((await asCookie('GET', '/api/auth/me', adminCookie)).statusCode).not.toBe(429)
  }, 60_000)

  it('/api/meta/routes lists what the token can call and nothing refused to tokens', async () => {
    const owner = await createPerson('meta', FEATURES)
    const { token } = await mint(owner, 'meta', ['clienti.view'])
    const res = await asToken('GET', '/api/meta/routes', token)
    expect(res.statusCode).toBe(200)
    const items: { method: string; path: string; feature: string | null }[] = res.json().data
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item).toHaveProperty('method')
      expect(item).toHaveProperty('path')
      expect(item).toHaveProperty('feature')
    }
    expect(items.some((i) => i.method === 'GET' && i.path === '/api/prospects')).toBe(true)
    expect(items.some((i) => i.method === 'POST' && i.path === '/api/prospects')).toBe(false)
    expect(items.some((i) => i.path.startsWith('/api/me/api-tokens'))).toBe(false)
    expect(items.some((i) => i.path.startsWith('/api/team'))).toBe(false)
  })

  it('a revoked token cannot be brought back; revoking again keeps the first revoked_at', async () => {
    const owner = await createPerson('again', FEATURES)
    const { token, item } = await mint(owner, 'once')
    expect((await asCookie('DELETE', `/api/me/api-tokens/${item.id}`, owner.cookie)).statusCode).toBe(200)
    const [first] = await db.select().from(apiTokens).where(eq(apiTokens.id, item.id))
    expect(first!.revokedAt).not.toBeNull()

    await asCookie('DELETE', `/api/me/api-tokens/${item.id}`, owner.cookie)
    const [second] = await db.select().from(apiTokens).where(eq(apiTokens.id, item.id))
    expect(second!.revokedAt!.getTime()).toBe(first!.revokedAt!.getTime())
    expect((await asToken('GET', '/api/auth/me', token)).statusCode).toBe(401)
  })

  it('a random Bearer on login does not open a new rate-limit bucket', async () => {
    // Regression: the bucket used to be keyed on the presented Bearer before it was checked, so a
    // different fake token per attempt bypassed the 5-per-15-minutes login limit.
    const codes: number[] = []
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '10.9.8.7',
        headers: { authorization: `Bearer vd_fake${attempt}${stamp}` },
        payload: { email: `nobody-${stamp}@example.com`, password: 'wrong-password-1' },
      })
      codes.push(res.statusCode)
    }
    expect(codes.at(-1)).toBe(429)
  })

  it('a token of a platform admin cannot reach the platform routes', async () => {
    const { token, item } = await mint({ cookie: adminCookie }, `qa platform ${stamp}`)
    try {
      expect(adminUser!.isPlatformAdmin).toBe(true)
      const res = await asToken('GET', '/api/platform/tenants', token)
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('TOKEN_NOT_ALLOWED')
    } finally {
      await db.delete(apiTokens).where(eq(apiTokens.id, item.id))
    }
  })

  it('a token created without a list is read-only: only the page gates of the role', async () => {
    const owner = await createPerson('default', FEATURES)
    const { token, item } = await mint(owner, 'default read-only')
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, item.id))
    expect(row!.features).toEqual(['clienti.view'])
    const write = await asToken('POST', '/api/prospects', token, { name: 'Acme QA default' })
    expect(write.statusCode).toBe(403)
  })
})
