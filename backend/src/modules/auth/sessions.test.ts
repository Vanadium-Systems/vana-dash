/**
 * Long sessions: login cookies, refresh rotation with grace and reuse detection, revocation on
 * logout / password change / disable, the devices list, legacy upgrade and the password step-up.
 */
import argon2 from 'argon2'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { auditLog, roles, userSessions, users } from '../../shared/db/schema/index.js'
import { hashRefreshToken } from '../../shared/lib/sessions.js'

const app = await buildServer()
await app.ready()

const PASSWORD = 'Parola-de-test-7731-xQ'
const passwordHash = await argon2.hash(PASSWORD)
const stamp = Date.now()
const userIds: string[] = []
const roleIds: string[] = []
let ipCounter = 0
let personCounter = 0

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select().from(users).where(eq(users.roleId, adminRole!.id)).limit(1)
const adminCookie = app.jwt.sign({ sub: adminUser!.id, sv: adminUser!.sessionVersion })

async function createPerson(features: string[] = ['clienti.view', 'echipa.tokenuri'], kind: 'custom' | 'admin' = 'custom') {
  personCounter += 1
  const label = `${stamp}-${personCounter}`
  const [role] = await db.insert(roles).values({ name: `QA sessions ${label}`, kind, features }).returning()
  roleIds.push(role!.id)
  const [person] = await db
    .insert(users)
    .values({ email: `qa-sessions-${label}@example.com`, passwordHash, displayName: `QA sessions ${personCounter}`, roleId: role!.id })
    .returning()
  userIds.push(person!.id)
  return { person: person!, role: role! }
}

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.entityId, userIds))
  await db.delete(userSessions).where(inArray(userSessions.userId, userIds))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

interface Cookies {
  vana_session: string
  vana_refresh: string
}

type InjectResponse = Awaited<ReturnType<typeof app.inject>>

const cookieValue = (res: InjectResponse, name: string) => res.cookies.find((cookie) => cookie.name === name)?.value

function merge(cookies: Cookies, res: InjectResponse): Cookies {
  return {
    vana_session: cookieValue(res, 'vana_session') ?? cookies.vana_session,
    vana_refresh: cookieValue(res, 'vana_refresh') ?? cookies.vana_refresh,
  }
}

async function login(email: string, password: string, ip?: string) {
  ipCounter += 1
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
    remoteAddress: ip ?? `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`,
  })
  return {
    res,
    cookies: { vana_session: cookieValue(res, 'vana_session')!, vana_refresh: cookieValue(res, 'vana_refresh')! } as Cookies,
  }
}

const call = (method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, cookies: Partial<Cookies>, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: cookies as Record<string, string>, payload })

const refresh = (cookies: Cookies) => call('POST', '/api/auth/refresh', { vana_refresh: cookies.vana_refresh })

async function loggedIn(features?: string[]) {
  const { person } = await createPerson(features)
  const { cookies } = await login(person.email, PASSWORD)
  return { person, cookies }
}

const familyRows = async (userId: string) => db.select().from(userSessions).where(eq(userSessions.userId, userId))
const rowByRefresh = async (token: string) => {
  const [row] = await db.select().from(userSessions).where(eq(userSessions.tokenHash, hashRefreshToken(token)))
  return row!
}

describe('login cookies', () => {
  it('sets an access cookie with sid (15 min) and a Strict refresh cookie on /api/auth', async () => {
    const { person } = await createPerson()
    const { res, cookies } = await login(person.email, PASSWORD)
    expect(res.statusCode).toBe(200)

    const refreshCookie = res.cookies.find((cookie) => cookie.name === 'vana_refresh')!
    expect(refreshCookie.path).toBe('/api/auth')
    expect(refreshCookie.httpOnly).toBe(true)
    expect(String(refreshCookie.sameSite).toLowerCase()).toBe('strict')
    expect(res.cookies.find((cookie) => cookie.name === 'vana_session')!.httpOnly).toBe(true)

    const payload = app.jwt.decode<{ sid?: string; exp: number; iat: number }>(cookies.vana_session)!
    expect(payload.sid).toBeTruthy()
    expect(payload.exp - payload.iat).toBe(900)

    const me = await call('GET', '/api/auth/me', { vana_session: cookies.vana_session })
    expect(me.statusCode).toBe(200)
    expect(me.json().data.sessionKind).toBe('long')
  })
})

describe('refresh rotation', () => {
  it('rotates the refresh token and marks the old row rotated', async () => {
    const { person, cookies } = await loggedIn()
    const res = await refresh(cookies)
    expect(res.statusCode).toBe(200)
    const next = merge(cookies, res)
    expect(next.vana_refresh).not.toBe(cookies.vana_refresh)

    const oldRow = await rowByRefresh(cookies.vana_refresh)
    const newRow = await rowByRefresh(next.vana_refresh)
    expect(oldRow.revokeReason).toBe('rotated')
    expect(oldRow.revokedAt).not.toBeNull()
    expect(oldRow.replacedById).toBe(newRow.id)
    expect(newRow.familyId).toBe(oldRow.familyId)
    expect((await familyRows(person.id)).length).toBe(2)

    expect((await call('GET', '/api/auth/me', { vana_session: next.vana_session })).statusCode).toBe(200)
  })

  it('the old token inside the 30 s grace window gets 200 and no new refresh cookie', async () => {
    const { cookies } = await loggedIn()
    expect((await refresh(cookies)).statusCode).toBe(200)
    const again = await refresh(cookies)
    expect(again.statusCode).toBe(200)
    expect(cookieValue(again, 'vana_refresh')).toBeUndefined()
    expect(cookieValue(again, 'vana_session')).toBeTruthy()
  })

  it('the old token after the grace window revokes the whole family and is audited', async () => {
    const { person, cookies } = await loggedIn()
    const first = await refresh(cookies)
    const latest = merge(cookies, first)

    await db
      .update(userSessions)
      .set({ revokedAt: sql`now() - interval '31 seconds'` })
      .where(eq(userSessions.tokenHash, hashRefreshToken(cookies.vana_refresh)))
    const reuse = await refresh(cookies)
    expect(reuse.statusCode).toBe(401)
    expect(reuse.json().error.code).toBe('SESSION_EXPIRED')

    const rows = await familyRows(person.id)
    expect(rows.length).toBe(2)
    expect(rows.every((row) => row.revokeReason === 'reuse')).toBe(true)

    expect((await call('GET', '/api/auth/me', { vana_session: latest.vana_session })).statusCode).toBe(401)
    expect((await refresh(latest)).statusCode).toBe(401)

    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'sesiune.refolosita'), eq(auditLog.entityId, person.id)))
    expect(audit.length).toBe(1)
  })

  it('an expired row is refused', async () => {
    const { person, cookies } = await loggedIn()
    await db.update(userSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(userSessions.userId, person.id))
    const res = await refresh(cookies)
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('SESSION_EXPIRED')
  })

  it('two parallel refreshes with the same cookie both succeed and leave one live row', async () => {
    const { person, cookies } = await loggedIn()
    const [a, b] = await Promise.all([refresh(cookies), refresh(cookies)])
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    const live = (await familyRows(person.id)).filter((row) => row.revokedAt === null)
    expect(live.length).toBe(1)
    const [stillLive] = await db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userId, person.id), isNull(userSessions.revokedAt)))
    expect(stillLive).toBeTruthy()
  })
})

describe('revocation', () => {
  it('logout kills both the refresh and the access cookie', async () => {
    const { cookies } = await loggedIn()
    expect((await call('POST', '/api/auth/logout', { vana_session: cookies.vana_session })).statusCode).toBe(200)
    expect((await refresh(cookies)).statusCode).toBe(401)
    expect((await call('GET', '/api/auth/me', { vana_session: cookies.vana_session })).statusCode).toBe(401)
  })

  it('a password change logs out the other device and starts a fresh family on this one', async () => {
    const { person } = await createPerson()
    const a = (await login(person.email, PASSWORD)).cookies
    const b = (await login(person.email, PASSWORD)).cookies

    const changed = await call('POST', '/api/auth/me/password', a, {
      currentPassword: PASSWORD,
      newPassword: 'Alta-parola-de-test-9154-zK',
    })
    expect(changed.statusCode).toBe(200)
    const aNext = merge(a, changed)
    expect(cookieValue(changed, 'vana_session')).toBeTruthy()
    expect(cookieValue(changed, 'vana_refresh')).toBeTruthy()

    expect((await refresh(b)).statusCode).toBe(401)
    expect((await call('GET', '/api/auth/me', { vana_session: b.vana_session })).statusCode).toBe(401)
    expect((await call('GET', '/api/auth/me', { vana_session: aNext.vana_session })).statusCode).toBe(200)
    expect((await refresh(aNext)).statusCode).toBe(200)
  })

  it('an admin disabling the person kills their refresh', async () => {
    const { person, cookies } = await loggedIn()
    const disabled = await call('PATCH', `/api/team/members/${person.id}`, { vana_session: adminCookie }, { status: 'disabled' })
    expect(disabled.statusCode).toBe(200)
    expect((await refresh(cookies)).statusCode).toBe(401)
    expect((await call('GET', '/api/auth/me', { vana_session: cookies.vana_session })).statusCode).toBe(401)
  })
})

describe('devices', () => {
  it('lists one entry per login with current on the caller; revoke-others keeps only this device', async () => {
    const { person } = await createPerson()
    const a = (await login(person.email, PASSWORD)).cookies
    const b = (await login(person.email, PASSWORD)).cookies

    const list = await call('GET', '/api/me/sessions', { vana_session: a.vana_session })
    expect(list.statusCode).toBe(200)
    const devices: Array<{ familyId: string; current: boolean }> = list.json().data
    expect(devices.length).toBe(2)
    expect(devices.filter((device) => device.current).length).toBe(1)

    const aFamily = (await rowByRefresh(a.vana_refresh)).familyId
    expect(devices.find((device) => device.current)!.familyId).toBe(aFamily)

    const revoked = await call('POST', '/api/me/sessions/revoke-others', { vana_session: a.vana_session })
    expect(revoked.statusCode).toBe(200)
    expect((await call('GET', '/api/auth/me', { vana_session: a.vana_session })).statusCode).toBe(200)
    expect((await refresh(a)).statusCode).toBe(200)
    expect((await refresh(b)).statusCode).toBe(401)
    expect((await call('GET', '/api/auth/me', { vana_session: b.vana_session })).statusCode).toBe(401)
  })

  it("another person's familyId is a 404 and stays alive", async () => {
    const mine = await loggedIn()
    const theirs = await loggedIn()
    const theirFamily = (await rowByRefresh(theirs.cookies.vana_refresh)).familyId
    const res = await call('DELETE', `/api/me/sessions/${theirFamily}`, { vana_session: mine.cookies.vana_session })
    expect(res.statusCode).toBe(404)
    expect((await refresh(theirs.cookies)).statusCode).toBe(200)

    const ownFamily = (await rowByRefresh(mine.cookies.vana_refresh)).familyId
    expect((await call('DELETE', `/api/me/sessions/${ownFamily}`, { vana_session: mine.cookies.vana_session })).statusCode).toBe(200)
    expect((await refresh(mine.cookies)).statusCode).toBe(401)
  })

  it('a Bearer API token cannot reach /api/me/sessions', async () => {
    const { cookies } = await loggedIn()
    const created = await call('POST', '/api/me/api-tokens', cookies, { name: 'sessions-test' })
    expect(created.statusCode).toBe(201)
    const { token } = created.json().data
    const res = await app.inject({ method: 'GET', url: '/api/me/sessions', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('TOKEN_NOT_ALLOWED')
  })
})

describe('legacy cookie upgrade', () => {
  it('a cookie without sid is legacy until /api/auth/upgrade-session moves it to a long session', async () => {
    const { person } = await createPerson()
    const legacy = app.jwt.sign({ sub: person.id, sv: person.sessionVersion })
    const before = await call('GET', '/api/auth/me', { vana_session: legacy })
    expect(before.json().data.sessionKind).toBe('legacy')

    const upgraded = await call('POST', '/api/auth/upgrade-session', { vana_session: legacy })
    expect(upgraded.statusCode).toBe(200)
    const session = cookieValue(upgraded, 'vana_session')
    const refreshToken = cookieValue(upgraded, 'vana_refresh')
    expect(session).toBeTruthy()
    expect(refreshToken).toBeTruthy()

    const after = await call('GET', '/api/auth/me', { vana_session: session })
    expect(after.json().data.sessionKind).toBe('long')
  })
})

describe('password step-up', () => {
  it('a fresh login is not asked; a stale confirmation is until the password is typed again', async () => {
    const { person, cookies } = await loggedIn()
    const first = await call('POST', '/api/me/api-tokens', cookies, { name: 'fresh' })
    expect(first.statusCode).toBe(201)

    await db
      .update(userSessions)
      .set({ passwordConfirmedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(userSessions.userId, person.id))
    const blocked = await call('POST', '/api/me/api-tokens', cookies, { name: 'stale' })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error.code).toBe('PASSWORD_CONFIRM_REQUIRED')

    const wrong = await call('POST', '/api/auth/confirm-password', cookies, { password: 'not-the-password' })
    expect(wrong.statusCode).toBe(401)
    const right = await call('POST', '/api/auth/confirm-password', cookies, { password: PASSWORD })
    expect(right.statusCode).toBe(200)

    const allowed = await call('POST', '/api/me/api-tokens', cookies, { name: 'confirmed' })
    expect(allowed.statusCode).toBe(201)
  })

  it('changing a member role asks for confirmation from an admin-role person with a stale session', async () => {
    const { person: boss } = await createPerson([], 'admin')
    const { person: target } = await createPerson()
    const { role: otherRole } = await createPerson(['clienti.view'])
    const { cookies } = await login(boss.email, PASSWORD)

    await db
      .update(userSessions)
      .set({ passwordConfirmedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(userSessions.userId, boss.id))
    const blocked = await call('PATCH', `/api/team/members/${target.id}`, cookies, { roleId: otherRole.id })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error.code).toBe('PASSWORD_CONFIRM_REQUIRED')

    expect((await call('POST', '/api/auth/confirm-password', cookies, { password: PASSWORD })).statusCode).toBe(200)
    const allowed = await call('PATCH', `/api/team/members/${target.id}`, cookies, { roleId: otherRole.id })
    expect(allowed.statusCode).toBe(200)
  })
})
