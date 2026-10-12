/**
 * /api/contracts/reserved-numbers — integration test, pg real + server real (app.inject).
 */
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { dashboardConfig, roles, users } from '../../shared/db/schema/index.js'
import { RESERVED_NUMBERS_CONFIG_KEY } from './reserved-numbers-service.js'

const URL = '/api/contracts/reserved-numbers'

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))

const app = await buildServer()
await app.ready()

const TEST_EMAIL = `qa-reserved-${Date.now()}@vanadium.systems`
const [testUser] = await db
  .insert(users)
  .values({ email: TEST_EMAIL, passwordHash: await argon2.hash('qa-test-password-123'), displayName: 'QA Stefan', roleId: adminRole!.id })
  .returning()
const token = await app.jwt.sign({ sub: testUser!.id, sv: testUser!.sessionVersion })

// Cheia e una singură pe toată baza: rândul de dinainte de test se pune la loc la final.
const [savedRow] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, RESERVED_NUMBERS_CONFIG_KEY))

beforeEach(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, RESERVED_NUMBERS_CONFIG_KEY))
})

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, RESERVED_NUMBERS_CONFIG_KEY))
  if (savedRow) await db.insert(dashboardConfig).values({ key: savedRow.key, value: savedRow.value })
  await db.delete(users).where(eq(users.id, testUser!.id))
  await app.close()
})

const get = () => app.inject({ method: 'GET', url: URL, cookies: { vana_session: token } })
const put = (payload: unknown) => app.inject({ method: 'PUT', url: URL, cookies: { vana_session: token }, payload: payload as object })

describe('numere de contract rezervate', () => {
  it('cere sesiune', async () => {
    expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(401)
  })

  it('pornește cu 003 rezervat cât timp nu s-a salvat nimic', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ number: '003', note: 'Contract de colaborare, în afara aplicației', date: '2026-09-28' }])
  })

  it('normalizează „3" la „003" și întoarce lista ordonată', async () => {
    const res = await put([
      { number: '12', note: 'Contract de mentenanță', date: '2026-10-05' },
      { number: '3', note: '  Contract de colaborare, în afara aplicației ', date: '2026-09-28' },
    ])
    expect(res.statusCode).toBe(200)
    const expected = [
      { number: '003', note: 'Contract de colaborare, în afara aplicației', date: '2026-09-28' },
      { number: '012', note: 'Contract de mentenanță', date: '2026-10-05' },
    ]
    expect(res.json().data).toEqual(expected)
    expect((await get()).json().data).toEqual(expected)
  })

  it('respinge același număr de două ori, și când diferă doar prin zerouri', async () => {
    const res = await put([
      { number: '3', note: 'Primul', date: '2026-09-28' },
      { number: '003', note: 'Al doilea', date: '2026-09-29' },
    ])
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: 'RESERVED_NUMBER_DUPLICATE' })
  })

  it('o listă golită rămâne goală, 003 nu reapare', async () => {
    expect((await put([])).statusCode).toBe(200)
    expect((await get()).json().data).toEqual([])
  })

  it.each([
    ['număr cu litere', { number: '3a', note: 'x', date: '2026-09-28' }],
    ['număr de cinci cifre', { number: '12345', note: 'x', date: '2026-09-28' }],
    ['notă goală', { number: '004', note: '  ', date: '2026-09-28' }],
    ['notă peste 120 de caractere', { number: '004', note: 'x'.repeat(121), date: '2026-09-28' }],
    ['dată în alt format', { number: '004', note: 'x', date: '28.09.2026' }],
  ])('respinge %s', async (_caz, entry) => {
    expect((await put([entry])).statusCode).toBe(400)
  })
})
