/**
 * Language and display currency of a person: /me, PATCH /me, the public locale route and the
 * language an error comes back in. Integration test, real pg + real server (app.inject).
 */
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { roles, users } from '../../shared/db/schema/index.js'
import { ENABLED_LOCALES } from '../../shared/lib/locale.js'

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const PASSWORD = 'qa-test-password-123'
const passwordHash = await argon2.hash(PASSWORD)
const stamp = Date.now()
const created = await db
  .insert(users)
  .values([
    { email: `qa-locale-ro-${stamp}@example.com`, passwordHash, roleId: adminRole!.id },
    { email: `qa-locale-en-${stamp}@example.com`, passwordHash, roleId: adminRole!.id, locale: 'en', displayCurrency: 'EUR' },
  ])
  .returning()
afterAll(async () => {
  await db.delete(users).where(inArray(users.id, created.map((user) => user.id)))
})

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })
  return res.cookies.find((cookie) => cookie.name === 'vana_session')!.value
}
const roCookie = await login(created[0]!.email)
const enCookie = await login(created[1]!.email)

const wrongPassword = (cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/me/password',
    cookies: { vana_session: cookie },
    payload: { currentPassword: 'not-the-password', newPassword: 'another-long-password' },
  })

describe('language of an error', () => {
  it('follows the person, not the installation', async () => {
    expect((await wrongPassword(roCookie)).json().error).toBe('Parola curentă nu e corectă')
    expect((await wrongPassword(enCookie)).json().error).toBe('The current password is not correct')
  })

  it('is the installation default without a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.com', password: 'x' } })
    expect(res.json().error).toBe('Email sau parolă greșită')
  })

  it('ignores a language that is not offered, sent from a page before login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-locale': 'fr' },
      payload: { email: 'nobody@example.com', password: 'x' },
    })
    expect(res.json().error).toBe('Email sau parolă greșită')
  })
})

describe('GET /api/auth/me', () => {
  it('carries the language and display currency of the person, with the lists to choose from', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { vana_session: enCookie } })
    expect(res.json().data).toMatchObject({
      locale: 'en',
      enabledLocales: [...ENABLED_LOCALES],
      displayCurrency: 'EUR',
      displayCurrencies: ['RON', 'EUR', 'USD'],
    })
  })
})

describe('PATCH /api/auth/me', () => {
  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/auth/me', cookies: { vana_session: roCookie }, payload })

  it('saves the display currency', async () => {
    const res = await patch({ displayCurrency: 'USD' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.displayCurrency).toBe('USD')
  })

  it('refuses a currency outside the list', async () => {
    expect((await patch({ displayCurrency: 'GBP' })).statusCode).toBe(400)
  })

  it('refuses a language outside the list', async () => {
    expect((await patch({ locale: 'fr' })).statusCode).toBe(400)
  })
})

describe('GET /api/auth/locale', () => {
  it('answers without a session and says nothing about the company', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/locale' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: { defaultLocale: 'ro', enabledLocales: [...ENABLED_LOCALES] } })
  })
})
