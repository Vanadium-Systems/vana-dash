/**
 * Home layout: a person's own layout, the company one, and the filter that keeps money widgets
 * away from people without the feature, even when the layout comes from the company.
 */
import argon2 from 'argon2'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { dashboardConfig, roles, users } from '../../shared/db/schema/index.js'
import { DEFAULT_COMPANY_LAYOUT, WIDGETS } from './widgets.js'
import { sessionToken } from '../../shared/testing/session-token.js'

const app = await buildServer()
await app.ready()

const userIds: string[] = []
const roleIds: string[] = []

async function user(email: string, features: string[]) {
  const [role] = await db
    .insert(roles)
    .values({ name: `Test: overview ${email}`, kind: 'custom', features })
    .returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await argon2.hash('parola-de-test-123'), roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, token: await sessionToken(app, row!.id) }
}

type Person = Awaited<ReturnType<typeof user>>
const ana = await user('qa-overview-ana@test.local', ['clienti.view', 'mesaje.view', 'echipa.view'])
const ion = await user('qa-overview-ion@test.local', ['financiar.view', 'clienti.view', 'echipa.view', 'echipa.administrare'])

const call = (method: 'GET' | 'PUT' | 'DELETE', url: string, who: Person, layout?: unknown) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, ...(layout ? { payload: { layout } } : {}) })
const ids = (res: { json: () => { data: { layout: Array<{ widget: string }> } } }) =>
  res.json().data.layout.map((item) => item.widget)

const savedCompany = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, 'home.layout'))

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, 'home.layout'))
  for (const row of savedCompany) await db.insert(dashboardConfig).values({ key: row.key, value: row.value })
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(and(inArray(roles.id, roleIds), isNull(roles.deletedAt)))
  await app.close()
})

describe('home layout', () => {
  it('the default layout only references known widgets, at allowed sizes', () => {
    for (const item of DEFAULT_COMPANY_LAYOUT) expect(WIDGETS[item.widget]?.sizes).toContain(item.size)
  })

  it('a person without financiar.view gets no money widgets from the company layout', async () => {
    const put = await call('PUT', '/api/dashboard/layout/company', ion, DEFAULT_COMPANY_LAYOUT)
    expect(put.statusCode).toBe(200)
    const res = await call('GET', '/api/dashboard/layout', ana)
    expect(res.json().data.source).toBe('company')
    expect(ids(res)).not.toContain('collected')
    expect(ids(res)).not.toContain('revenue')
    expect(ids(res)).toContain('my_tasks')
    expect(ids(await call('GET', '/api/dashboard/layout', ion))).toContain('revenue')
  })

  it('PUT personal leaves the company layout and other people alone; DELETE goes back to the company', async () => {
    const own = [{ widget: 'my_tasks', size: 'l', order: 0 }]
    const put = await call('PUT', '/api/dashboard/layout', ana, own)
    expect(put.statusCode).toBe(200)
    expect(put.json().data.source).toBe('user')
    expect(ids(await call('GET', '/api/dashboard/layout', ana))).toEqual(['my_tasks'])
    const other = await call('GET', '/api/dashboard/layout', ion)
    expect(other.json().data.source).toBe('company')
    expect(ids(other)).toContain('revenue')
    const reset = await call('DELETE', '/api/dashboard/layout', ana)
    expect(reset.json().data.source).toBe('company')
  })

  it('PUT personal rejects a widget the person cannot see', async () => {
    const res = await call('PUT', '/api/dashboard/layout', ana, [{ widget: 'revenue', size: 'w', order: 0 }])
    expect(res.statusCode).toBe(400)
  })

  it('PUT company without echipa.administrare is 403', async () => {
    const res = await call('PUT', '/api/dashboard/layout/company', ana, DEFAULT_COMPANY_LAYOUT)
    expect(res.statusCode).toBe(403)
  })

  it('validation: size not allowed, too many items, duplicates, unknown widget', async () => {
    const bad = (layout: unknown) => call('PUT', '/api/dashboard/layout', ion, layout)
    expect((await bad([{ widget: 'collected', size: 's', order: 0 }])).statusCode).toBe(400)
    const many = Object.keys(WIDGETS).map((widget, order) => ({ widget, size: WIDGETS[widget]!.sizes[0], order }))
    const tooMany = [...many, ...many.slice(0, 25 - many.length).map((item, i) => ({ ...item, order: 30 + i }))]
    expect(tooMany.length).toBe(25)
    expect((await bad(tooMany)).statusCode).toBe(400)
    const dup = [
      { widget: 'collected', size: 'w', order: 0 },
      { widget: 'collected', size: 'l', order: 1 },
    ]
    expect((await bad(dup)).statusCode).toBe(400)
    expect((await bad([{ widget: 'nope', size: 'w', order: 0 }])).statusCode).toBe(400)
  })
})
