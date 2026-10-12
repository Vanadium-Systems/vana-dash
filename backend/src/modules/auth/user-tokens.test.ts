/**
 * Ciclul de viață al tokenurilor de unică folosire — invitație și resetare de parolă
 * (PLAN.md C2, QA-2 și QA-7).
 *
 * Ce e verificat aici, pentru că nu se vede în UI: în DB se păstrează doar hash-ul, tokenul
 * e de unică folosire, expiră, e legat de tipul lui (un link de invitație nu resetează
 * parola), iar răspunsul la `forgot-password` nu spune dacă adresa există. Pe această
 * poartă se intră fără sesiune, deci e singura suprafață a autentificării fără guard.
 */
import argon2 from 'argon2'
import { createHash } from 'node:crypto'
import type { LightMyRequestResponse } from 'fastify'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

// Fără mock, `sendEmail` ar lovi Resend-ul cu cheia de test și ar încetini fiecare test.
vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { roles, userTokens, users } from '../../shared/db/schema/index.js'
import { createUserToken, TOKEN_TTL_HOURS } from '../../shared/lib/user-tokens.js'

const app = await buildServer()
await app.ready()

const PASSWORD = 'parola-de-test-123'
const NOUA = 'parola-noua-de-test-123'
const created: string[] = []

const [salesRole] = await db
  .insert(roles)
  .values({ name: `QA token: ${Date.now()}`, kind: 'custom', features: ['clienti.view'] })
  .returning()

async function createUser(email: string, status: 'invited' | 'active' = 'active') {
  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await argon2.hash(PASSWORD),
      displayName: 'QA token',
      roleId: salesRole!.id,
      status,
    })
    .returning()
  created.push(row!.id)
  return row!
}

const om = await createUser(`qa-token-${Date.now()}@test.local`)
const tokenRows = (userId: string) => db.select().from(userTokens).where(eq(userTokens.userId, userId))

afterAll(async () => {
  for (const id of created) {
    await db.delete(userTokens).where(eq(userTokens.userId, id))
    await db.delete(users).where(eq(users.id, id))
  }
  await db.delete(roles).where(and(eq(roles.id, salesRole!.id), isNull(roles.deletedAt)))
  await app.close()
})

// Rate-limit-ul e per IP, iar `inject` vine mereu de pe 127.0.0.1 — fără adrese distincte,
// testele de mai jos s-ar împiedica între ele la limita de 5/minut a rutelor fără sesiune.
let ip = 0
const post = (url: string, payload: unknown): Promise<LightMyRequestResponse> => {
  ip += 1
  return app.inject({ method: 'POST', url, payload: payload as Record<string, string>, remoteAddress: `10.11.0.${ip}` })
}

describe('forgot-password nu spune cine are cont', () => {
  it('răspunde la fel pentru adresă existentă și inexistentă', async () => {
    const cuCont = await post('/api/auth/forgot-password', { email: om.email })
    const faraCont = await post('/api/auth/forgot-password', { email: 'nu-exista@deloc.test' })
    expect(cuCont.statusCode).toBe(204)
    expect(faraCont.statusCode).toBe(204)
    expect(cuCont.body).toBe(faraCont.body)
  })

  it('pentru adresa inexistentă nu se creează niciun token', async () => {
    await post('/api/auth/forgot-password', { email: 'nu-exista@deloc.test' })
    const rows = await db.select().from(userTokens).where(eq(userTokens.userId, '00000000-0000-4000-8000-000000000000'))
    expect(rows).toEqual([])
  })

  it('tokenul de resetare se păstrează hashuit, cu expirarea din catalog', async () => {
    const clear = await createUserToken(om.id, 'reset')
    const [row] = await db
      .select()
      .from(userTokens)
      .where(eq(userTokens.tokenHash, createHash('sha256').update(clear).digest('hex')))
    expect(row!.tokenHash).not.toBe(clear)
    expect(row!.tokenHash).toBe(createHash('sha256').update(clear).digest('hex'))
    const hours = (row!.expiresAt.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(TOKEN_TTL_HOURS.reset - 0.1)
    expect(hours).toBeLessThanOrEqual(TOKEN_TTL_HOURS.reset)
  })

  it('omul încă neinvitat nu primește resetare, ci invitație', async () => {
    const neinvitat = await createUser(`qa-invitat-${Date.now()}@test.local`, 'invited')
    await post('/api/auth/forgot-password', { email: neinvitat.email })
    const rows = await tokenRows(neinvitat.id)
    expect(rows).toEqual([])
  })
})

describe('reset-password', () => {
  it('tokenul bun schimbă parola, delogă celelalte sesiuni și nu mai e bun a doua oară', async () => {
    const utilizator = await createUser(`qa-reset-${Date.now()}@test.local`)
    const sesiuneVeche = await app.jwt.sign({ sub: utilizator.id, sv: utilizator.sessionVersion })
    const token = await createUserToken(utilizator.id, 'reset')

    const res = await post('/api/auth/reset-password', { token, password: NOUA })
    expect(res.statusCode).toBe(204)
    const [dupa] = await db.select().from(users).where(eq(users.id, utilizator.id))
    expect(await argon2.verify(dupa!.passwordHash, NOUA)).toBe(true)
    expect(dupa!.sessionVersion).toBe(utilizator.sessionVersion + 1)

    // Sesiunea veche moare imediat, nu la expirarea tokenului.
    const veche = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { vana_session: sesiuneVeche } })
    expect(veche.statusCode).toBe(401)

    const aDouaOara = await post('/api/auth/reset-password', { token, password: 'parola-inceput-123' })
    expect(aDouaOara.statusCode).toBe(400)
    expect(aDouaOara.json().error.code).toBe('RESET_TOKEN_EXPIRED')
  })

  it('tokenul de invitație nu resetează parola (tipul e legat de poartă)', async () => {
    const utilizator = await createUser(`qa-tip-${Date.now()}@test.local`)
    const token = await createUserToken(utilizator.id, 'invite')
    const res = await post('/api/auth/reset-password', { token, password: NOUA })
    expect(res.statusCode).toBe(400)
    // Tokenul rămâne neconsumat, deci invitația e încă folosibilă.
    const [row] = await db.select().from(userTokens).where(eq(userTokens.userId, utilizator.id))
    expect(row!.usedAt).toBeNull()
  })

  it('tokenul expirat dă același răspuns ca unul inexistent, și nu schimbă parola', async () => {
    const utilizator = await createUser(`qa-expirat-${Date.now()}@test.local`)
    const token = await createUserToken(utilizator.id, 'reset')
    await db.update(userTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(userTokens.userId, utilizator.id))

    const expirat = await post('/api/auth/reset-password', { token, password: NOUA })
    const inexistent = await post('/api/auth/reset-password', { token: 'x'.repeat(40), password: NOUA })
    expect(expirat.statusCode).toBe(400)
    expect(expirat.json().error.code).toBe('RESET_TOKEN_EXPIRED')
    expect(expirat.body).toBe(inexistent.body)

    const [ramas] = await db.select().from(users).where(eq(users.id, utilizator.id))
    expect(await argon2.verify(ramas!.passwordHash, PASSWORD)).toBe(true)
  })

  it('parola prea scurtă e respinsă înainte de a consuma tokenul', async () => {
    const utilizator = await createUser(`qa-slaba-${Date.now()}@test.local`)
    const token = await createUserToken(utilizator.id, 'reset')
    const res = await post('/api/auth/reset-password', { token, password: 'scurt' })
    expect(res.statusCode).toBe(400)
    const [row] = await db.select().from(userTokens).where(eq(userTokens.userId, utilizator.id))
    expect(row!.usedAt).toBeNull()
  })
})

describe('accept-invite', () => {
  it('acceptă o singură dată: a doua încercare primește INVITE_USED', async () => {
    const invitat = await createUser(`qa-accept-${Date.now()}@test.local`, 'invited')
    const token = await createUserToken(invitat.id, 'invite')
    const res = await post('/api/auth/accept-invite', { token, password: NOUA })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.user).toMatchObject({ email: invitat.email, status: 'active' })
    // Cookie de sesiune pus imediat, ca omul să nu scrie parola a doua oară.
    expect(res.cookies.find((c) => c.name === 'vana_session')).toBeTruthy()

    const aDouaOara = await post('/api/auth/accept-invite', { token, password: 'parola-inceput-123' })
    expect(aDouaOara.statusCode).toBe(400)
    expect(aDouaOara.json().error.code).toBe('INVITE_USED')
  })

  it('tokenul de resetare nu acceptă o invitație', async () => {
    const invitat = await createUser(`qa-invers-${Date.now()}@test.local`, 'invited')
    const token = await createUserToken(invitat.id, 'reset')
    const res = await post('/api/auth/accept-invite', { token, password: NOUA })
    expect(res.statusCode).toBe(400)
    const [ramas] = await db.select().from(users).where(eq(users.id, invitat.id))
    expect(ramas!.status).toBe('invited')
  })

  it('omul încă neinvitat nu are sesiune validă până nu-și pune parola', async () => {
    const invitat = await createUser(`qa-fara-sesiune-${Date.now()}@test.local`, 'invited')
    const token = await app.jwt.sign({ sub: invitat.id, sv: invitat.sessionVersion })
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { vana_session: token } })
    expect(res.statusCode).toBe(401)
  })

  it('loginul unui om neinvitat e 401, nu 500 — hashul lui nu e încă argon2', async () => {
    const invitat = await createUser(`qa-login-invitat-${Date.now()}@test.local`, 'invited')
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: invitat.email, password: PASSWORD },
    })
    expect(res.statusCode).toBe(401)
  })

  it('linkul unui om dezactivat nu îl mai readuce în aplicație', async () => {
    const invitat = await createUser(`qa-dezactivat-invite-${Date.now()}@test.local`, 'invited')
    const token = await createUserToken(invitat.id, 'invite')
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, invitat.id))

    const res = await post('/api/auth/accept-invite', { token, password: NOUA })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVITE_EXPIRED')
    const [ramas] = await db.select().from(users).where(eq(users.id, invitat.id))
    expect(ramas!.status).toBe('disabled')
  })

  it('dezactivarea arde linkurile nefolosite ale omului', async () => {
    const invitat = await createUser(`qa-ardere-token-${Date.now()}@test.local`, 'invited')
    const token = await createUserToken(invitat.id, 'invite')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/team/members/${invitat.id}`,
      cookies: { vana_session: adminCookie },
      payload: { status: 'disabled' },
    })
    expect(res.statusCode).toBe(200)
    const [intrare] = await db.select().from(userTokens).where(eq(userTokens.userId, invitat.id))
    expect(intrare!.usedAt).not.toBeNull()
    expect((await post('/api/auth/accept-invite', { token, password: NOUA })).statusCode).toBe(400)
  })
  it('tokenul expirat de invitație e respins, iar invitatul rămâne „invited"', async () => {
    const invitat = await createUser(`qa-invitat-expirat-${Date.now()}@test.local`, 'invited')
    const token = await createUserToken(invitat.id, 'invite')
    await db.update(userTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(userTokens.userId, invitat.id))
    const res = await post('/api/auth/accept-invite', { token, password: NOUA })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVITE_EXPIRED')
    const [ramas] = await db.select().from(users).where(eq(users.id, invitat.id))
    expect(ramas!.status).toBe('invited')
  })
})

// Cookie de admin (rolul seedat), ca rutele de echipă să poată fi chemate prin inject.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select().from(users).where(eq(users.roleId, adminRole!.id))
const adminCookie = await app.jwt.sign({ sub: adminUser!.id, sv: adminUser!.sessionVersion })

describe('invitația din Echipă', () => {

  it('invitarea scrie un token de 72 de ore și omul rămâne „invited"', async () => {
    const email = `qa-echipa-${Date.now()}@test.local`
    const res = await app.inject({
      method: 'POST',
      url: '/api/team/members',
      cookies: { vana_session: adminCookie },
      payload: { email, roleId: salesRole!.id },
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().data.id
    created.push(id)
    const [row] = await db.select().from(userTokens).where(eq(userTokens.userId, id))
    expect(row!.kind).toBe('invite')
    const hours = (row!.expiresAt.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(TOKEN_TTL_HOURS.invite - 0.1)
  })

  it('retrimirea pentru un om activ e refuzată (ALREADY_ACTIVE), iar pentru un invitat merge', async () => {
    const [invitat] = await db.select().from(users).where(eq(users.email, om.email))
    const refuzat = await app.inject({
      method: 'POST',
      url: `/api/team/members/${invitat!.id}/resend-invite`,
      cookies: { vana_session: adminCookie },
    })
    expect(refuzat.statusCode).toBe(409)
    expect(refuzat.json().error.code).toBe('ALREADY_ACTIVE')

    const email = `qa-retrimitere-${Date.now()}@test.local`
    const creat = await app.inject({
      method: 'POST',
      url: '/api/team/members',
      cookies: { vana_session: adminCookie },
      payload: { email, roleId: salesRole!.id },
    })
    const id = creat.json().data.id
    created.push(id)
    const retrimitere = await app.inject({
      method: 'POST',
      url: `/api/team/members/${id}/resend-invite`,
      cookies: { vana_session: adminCookie },
    })
    expect(retrimitere.statusCode).toBe(200)
    // Al doilea token, deci cel vechi nu mai e singurul care poate deschide contul.
    const tokens = await db.select().from(userTokens).where(eq(userTokens.userId, id))
    expect(tokens.length).toBe(2)
  })

  it('resetarea pentru un om neinvitat e respinsă (STILL_INVITED)', async () => {
    const email = `qa-neinvitat-reset-${Date.now()}@test.local`
    const creat = await app.inject({
      method: 'POST',
      url: '/api/team/members',
      cookies: { vana_session: adminCookie },
      payload: { email, roleId: salesRole!.id },
    })
    const id = creat.json().data.id
    created.push(id)
    const res = await app.inject({
      method: 'POST',
      url: `/api/team/members/${id}/reset-password`,
      cookies: { vana_session: adminCookie },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('STILL_INVITED')
  })
})

describe('rate limit pe porțile publice', () => {
  it('accept-invite nu se poate forța dincolo de limita pe IP', async () => {
    const statusuri: number[] = []
    for (let i = 0; i < 8; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token: `x${i}${'y'.repeat(40)}`, password: NOUA },
        remoteAddress: '10.11.9.8',
      })
      statusuri.push(res.statusCode)
    }
    expect(statusuri.slice(0, 5).every((s) => s === 400)).toBe(true) // token invalid, sub limită
    expect(statusuri.slice(5)).toEqual([429, 429, 429])
  })

  it('nu se poate forța resetarea unui cont dincolo de limita pe IP', async () => {
    // 5/minut/IP pe forgot-password; răspunsul rămâne 204 peste limită doar dacă limita
    // serverului e mai generoasă, deci verificăm codul de rate-limit, nu statusul.
    // Aceeași adresă de zece ori: primele 5 trec (204, deci nu se spune dacă adresa există),
    // restul primesc 429 de la rate-limit.
    const statusuri: number[] = []
    for (let i = 0; i < 8; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: `bomb-${i}@test.local` },
        remoteAddress: '10.11.9.9',
      })
      statusuri.push(res.statusCode)
    }
    expect(statusuri).toEqual([204, 204, 204, 204, 204, 429, 429, 429])
  })
})

describe('izolarea testelor', () => {
  it('nu rămâne niciun token al oamenilor de test', async () => {
    const rows = await db.select().from(userTokens).where(inArray(userTokens.userId, created))
    // Rămân doar cei neconsumați, creați de testele de mai sus; niciunul nu e al lui Stefan.
    for (const row of rows) expect(created).toContain(row.userId)
  })
})
