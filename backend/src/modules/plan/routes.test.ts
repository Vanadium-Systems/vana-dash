/**
 * modules/plan/routes.ts — integration test, pg real + server real (app.inject).
 */
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { planGoals, users, roles } from '../../shared/db/schema/index.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const TEST_EMAIL = `qa-plan-${Date.now()}@vanadium.systems`
const TEST_PASSWORD = 'qa-test-password-123'
const passwordHash = await argon2.hash(TEST_PASSWORD)
const [testUser] = await db.insert(users).values({ email: TEST_EMAIL, passwordHash, displayName: 'QA Stefan', roleId: adminRoleId }).returning()

const goalIds: string[] = []
afterAll(async () => {
  if (goalIds.length) await db.delete(planGoals).where(inArray(planGoals.id, goalIds))
  await db.delete(users).where(eq(users.id, testUser!.id))
})

function sessionCookieValue(res: { cookies: { name: string; value: string }[] }): string {
  const cookie = res.cookies.find((c) => c.name === 'vana_session')
  if (!cookie) throw new Error('vana_session cookie lipsă din răspuns')
  return cookie.value
}

const stefanLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: TEST_EMAIL, password: TEST_PASSWORD } })
const stefanCookie = sessionCookieValue(stefanLogin)

describe('/api/plan — auth', () => {
  it('respinge lipsa oricărei sesiuni cu 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plan' })
    expect(res.statusCode).toBe(401)
  })

  it('permite Stefan pe GET /api/plan', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plan', cookies: { vana_session: stefanCookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveProperty('mrrRon')
  })
})

describe('CRUD flow complet, ca Stefan', () => {
  it('creează, editează, completează, reordonează, șterge un goal', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/plan',
      cookies: { vana_session: stefanCookie },
      payload: { scope: 'personal', title: 'QA route goal', thresholdType: 'manual' },
    })
    expect(create.statusCode).toBe(201)
    const goal = create.json().data
    goalIds.push(goal.id)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/plan/${goal.id}`,
      cookies: { vana_session: stefanCookie },
      payload: { title: 'QA route goal editat' },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().data.title).toBe('QA route goal editat')

    const complete = await app.inject({
      method: 'PATCH',
      url: `/api/plan/${goal.id}/complete`,
      cookies: { vana_session: stefanCookie },
      payload: { completed: true },
    })
    expect(complete.statusCode).toBe(200)
    expect(complete.json().data.completedAt).not.toBeNull()

    const reorder = await app.inject({
      method: 'POST',
      url: '/api/plan/reorder',
      cookies: { vana_session: stefanCookie },
      payload: { scope: 'personal', tier: 1, orderedIds: [goal.id] },
    })
    expect(reorder.statusCode).toBe(200)

    const del = await app.inject({ method: 'DELETE', url: `/api/plan/${goal.id}`, cookies: { vana_session: stefanCookie } })
    expect(del.statusCode).toBe(200)
  })

  it('respinge reorder cu payload invalid (orderedIds gol) cu 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/reorder',
      cookies: { vana_session: stefanCookie },
      payload: { scope: 'personal', tier: 1, orderedIds: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('respinge reorder cu payload fără tier cu 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/reorder',
      cookies: { vana_session: stefanCookie },
      payload: { scope: 'personal', orderedIds: ['00000000-0000-0000-0000-000000000000'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('respinge reorder cu id care nu există în pistă cu 400', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/plan',
      cookies: { vana_session: stefanCookie },
      payload: { scope: 'firma', title: 'QA reorder route goal', thresholdType: 'manual' },
    })
    goalIds.push(create.json().data.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/reorder',
      cookies: { vana_session: stefanCookie },
      payload: { scope: 'firma', tier: 1, orderedIds: ['00000000-0000-0000-0000-000000000000'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('întoarce 404 pt. PATCH pe un id inexistent', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/plan/00000000-0000-0000-0000-000000000000',
      cookies: { vana_session: stefanCookie },
      payload: { title: 'nu contează' },
    })
    expect(res.statusCode).toBe(404)
  })
})
