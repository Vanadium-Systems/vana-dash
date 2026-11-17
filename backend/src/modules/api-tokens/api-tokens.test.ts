/**
 * Personal API tokens: the clear value is shown once, only the hash is stored, a token never
 * exceeds the role's features, and deactivating a person kills their tokens.
 */
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { apiTokens, auditLog, roles, users } from '../../shared/db/schema/index.js'
import { hashApiToken } from '../../shared/lib/api-tokens.js'

const app = await buildServer()
await app.ready()

const passwordHash = await argon2.hash('parola-de-test-123')
const stamp = Date.now()
const userIds: string[] = []
const roleIds: string[] = []

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select().from(users).where(eq(users.roleId, adminRole!.id)).limit(1)
const adminCookie = app.jwt.sign({ sub: adminUser!.id, sv: adminUser!.sessionVersion })

async function createPerson(label: string, features: string[]) {
  const [role] = await db.insert(roles).values({ name: `QA api tokens ${label}: ${stamp}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [person] = await db
    .insert(users)
    .values({ email: `qa-api-${label}-${stamp}@example.com`, passwordHash, displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(person!.id)
  return { person: person!, cookie: app.jwt.sign({ sub: person!.id, sv: person!.sessionVersion }) }
}

const withTokens = await createPerson('owner', ['clienti.view', 'clienti.prospectare', 'echipa.tokenuri'])
const withoutTokens = await createPerson('plain', ['clienti.view'])
const other = await createPerson('other', ['clienti.view', 'echipa.tokenuri'])

afterAll(async () => {
  const tokenIds = (await db.select({ id: apiTokens.id }).from(apiTokens).where(inArray(apiTokens.userId, userIds))).map((row) => row.id)
  if (tokenIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, tokenIds))
  await db.delete(apiTokens).where(inArray(apiTokens.userId, userIds))
  await db.delete(auditLog).where(inArray(auditLog.entityId, userIds))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

const call = (method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, cookie: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: { vana_session: cookie }, payload })

describe('api tokens', () => {
  it('create shows the clear token once; the list has the prefix and no hash', async () => {
    const created = await call('POST', '/api/me/api-tokens', withTokens.cookie, { name: '  laptop  ' })
    expect(created.statusCode).toBe(201)
    const { token, item } = created.json().data
    expect(token).toMatch(/^vd_/)
    expect(item.name).toBe('laptop')
    expect(item.expiresAt).not.toBeNull()
    expect(token).toContain(item.prefix)

    const list = await call('GET', '/api/me/api-tokens', withTokens.cookie)
    const body = list.body
    expect(body).not.toContain(token)
    expect(body).not.toContain(hashApiToken(token))
    expect(body).not.toContain('tokenHash')
    expect(list.json().data[0]).toMatchObject({ id: item.id, prefix: item.prefix, revokedAt: null, features: ['clienti.view'] })
  })

  it('expiresInDays null means it never expires', async () => {
    const created = await call('POST', '/api/me/api-tokens', withTokens.cookie, { name: 'forever', expiresInDays: null })
    expect(created.json().data.item.expiresAt).toBeNull()
  })

  it('features outside the role are refused', async () => {
    const res = await call('POST', '/api/me/api-tokens', withTokens.cookie, { name: 'wide', features: ['clienti.view', 'facturi.view'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('FEATURES_NOT_IN_ROLE')
  })

  it('without echipa.tokenuri creation is 403', async () => {
    const res = await call('POST', '/api/me/api-tokens', withoutTokens.cookie, { name: 'nope' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: 'FEATURE_FORBIDDEN', feature: 'echipa.tokenuri' })
  })

  it('revoking own token sets revokedAt; the token stops working', async () => {
    const created = await call('POST', '/api/me/api-tokens', withTokens.cookie, { name: 'short-lived' })
    const { token, item } = created.json().data
    const before = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(before.statusCode).toBe(200)

    const revoked = await call('DELETE', `/api/me/api-tokens/${item.id}`, withTokens.cookie)
    expect(revoked.statusCode).toBe(200)
    const list = await call('GET', '/api/me/api-tokens', withTokens.cookie)
    expect(list.json().data.find((row: { id: string }) => row.id === item.id).revokedAt).not.toBeNull()
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(after.statusCode).toBe(401)
  })

  it("another person's token is a 404 on /api/me", async () => {
    const created = await call('POST', '/api/me/api-tokens', other.cookie, { name: 'theirs' })
    const res = await call('DELETE', `/api/me/api-tokens/${created.json().data.item.id}`, withTokens.cookie)
    expect(res.statusCode).toBe(404)
    expect((await call('DELETE', '/api/me/api-tokens/00000000-0000-4000-8000-000000000000', withTokens.cookie)).statusCode).toBe(404)
  })

  it('the admin lists non-revoked tokens with the owner and revokes any', async () => {
    const created = await call('POST', '/api/me/api-tokens', other.cookie, { name: 'admin-view' })
    const id = created.json().data.item.id
    const list = await call('GET', '/api/admin/api-tokens', adminCookie)
    expect(list.statusCode).toBe(200)
    const row = list.json().data.find((entry: { id: string }) => entry.id === id)
    expect(row.user).toMatchObject({ id: other.person.id, email: other.person.email })
    expect(list.body).not.toContain('tokenHash')
    expect(list.json().data.every((entry: { revokedAt: unknown }) => entry.revokedAt === null)).toBe(true)

    expect((await call('DELETE', `/api/admin/api-tokens/${id}`, adminCookie)).statusCode).toBe(200)
    const [stored] = await db.select().from(apiTokens).where(eq(apiTokens.id, id))
    expect(stored!.revokedAt).not.toBeNull()
    expect((await call('DELETE', '/api/admin/api-tokens/00000000-0000-4000-8000-000000000000', adminCookie)).statusCode).toBe(404)
  })

  it('a colleague without echipa.administrare cannot use the admin routes', async () => {
    expect((await call('GET', '/api/admin/api-tokens', withTokens.cookie)).statusCode).toBe(403)
  })

  it('a bearer token sees the intersection of its features and the role', async () => {
    const created = await call('POST', '/api/me/api-tokens', withTokens.cookie, { name: 'narrow', features: ['clienti.view'] })
    const { token } = created.json().data
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(me.statusCode).toBe(200)
    const features: string[] = me.json().data.features
    expect(features).toContain('clienti.view')
    expect(features).not.toContain('clienti.prospectare')
    expect(features).not.toContain('echipa.tokenuri')
  })

  it('disabling a person revokes their tokens', async () => {
    const victim = await createPerson('victim', ['clienti.view', 'echipa.tokenuri'])
    const created = await call('POST', '/api/me/api-tokens', victim.cookie, { name: 'doomed' })
    const { token, item } = created.json().data

    const disabled = await call('PATCH', `/api/team/members/${victim.person.id}`, adminCookie, { status: 'disabled' })
    expect(disabled.statusCode).toBe(200)
    const [stored] = await db.select().from(apiTokens).where(eq(apiTokens.id, item.id))
    expect(stored!.revokedAt).not.toBeNull()
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
  })

  it('history shows the token a change came through', async () => {
    const created = await call('POST', '/api/me/api-tokens', withTokens.cookie, { name: 'audited' })
    const id = created.json().data.item.id
    const history = await call('GET', `/api/audit?entityType=api_token&entityId=${id}`, adminCookie)
    expect(history.statusCode).toBe(200)
    expect(history.json().data[0]).toMatchObject({ action: 'api_token.creat', viaToken: null })
  })
})
