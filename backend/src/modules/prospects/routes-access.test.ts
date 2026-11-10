/**
 * Over HTTP, with real roles: what an agent without `clienti.toti` sees and can write on every prospect route,
 * and the rights the routes ask for beyond the catalog (export, promote, the assistant). Two agents: A without
 * `clienti.toti`, B with it, plus one more agent with only the export right.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { auditLog, calls, prospects, roles, users } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const AGENT = ['clienti.view', 'clienti.prospectare', 'cautare.view']

const userIds: string[] = []
const roleIds: string[] = []
const prospectIds: string[] = []

interface Person {
  id: string
  token: string
}

async function makePerson(label: string, features: string[]): Promise<Person> {
  const [role] = await db.insert(roles).values({ name: `QA access ${label} ${RUN}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

const call = (who: Person, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, payload })

const newProspect = async (name: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `QAAC ${RUN} ${name}`, ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}

let a: Person
let b: Person
let exporter: Person
let mine: string
let theirs: string
let free: string

beforeAll(async () => {
  a = await makePerson('a', AGENT)
  b = await makePerson('b', [...AGENT, 'clienti.toti', 'clienti.export', 'facturi.clienti'])
  exporter = await makePerson('exporter', ['clienti.view', 'clienti.export'])
  mine = await newProspect('mine', { assignedUserId: a.id })
  theirs = await newProspect('theirs', { assignedUserId: b.id })
  free = await newProspect('free')
})

afterAll(async () => {
  if (prospectIds.length) {
    await db.delete(calls).where(inArray(calls.prospectId, prospectIds))
    await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
    await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  }
  await db.delete(auditLog).where(and(eq(auditLog.action, 'prospect.export'), inArray(auditLog.actorUserId, userIds)))
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
})

describe('the timeline of an own prospect', () => {
  it('reads, a video call included (calls have no creator column)', async () => {
    const room = randomUUID().replace(/-/g, '').slice(0, 24)
    await db.insert(calls).values({ title: 'Demo', roomName: room, roomUrl: `https://example.com/${room}`, publicId: room, expiresAt: new Date(Date.now() + 3600_000), prospectId: mine })
    const res = await call(a, 'GET', `/api/prospects/${mine}/timeline`)
    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.json())).toContain('"call"')
  })
})

describe('a prospect of a colleague, for an agent without clienti.toti', () => {
  it('answers 404 on every read route', async () => {
    for (const path of ['', '/neighbors', '/timeline', '/people', '/notes', '/tasks']) {
      const res = await call(a, 'GET', `/api/prospects/${theirs}${path}`)
      expect(res.statusCode, `GET ${path || '/:id'}`).toBe(404)
    }
    expect((await call(b, 'GET', `/api/prospects/${theirs}`)).statusCode).toBe(200)
  })

  it('answers 404 on the write routes too, a note included', async () => {
    const responses = await Promise.all([
      call(a, 'PATCH', `/api/prospects/${theirs}`, { name: 'x' }),
      call(a, 'DELETE', `/api/prospects/${theirs}`),
      call(a, 'POST', `/api/prospects/${theirs}/notes`, { body: 'hello' }),
      call(a, 'POST', `/api/prospects/${theirs}/people`, { name: 'Ion' }),
      call(a, 'POST', `/api/prospects/${theirs}/tasks`, { kind: 'call', title: 'x', dueAt: new Date().toISOString() }),
    ])
    expect(responses.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404])
  })

  it('is not in the list, the count or Ctrl K, with or without an owner filter', async () => {
    const name = encodeURIComponent(`QAAC ${RUN}`)
    const list = (await call(a, 'GET', `/api/prospects?q=${name}&pageSize=100`)).json().data.rows as Array<{ id: string }>
    expect(list.map((r) => r.id).sort()).toEqual([mine, free].sort())
    const count = (await call(a, 'GET', `/api/prospects/count?q=${name}`)).json().data
    expect(count.total).toBe(2)
    const f = encodeURIComponent(JSON.stringify([{ field: 'owner', op: 'in', value: [b.id] }]))
    expect((await call(a, 'GET', `/api/prospects?q=${name}&f=${f}`)).json().data.rows).toEqual([])

    const search = (await call(a, 'GET', `/api/search?q=${name}`)).json().data as Array<{ items: Array<{ id: string }> }>
    const ids = search.flatMap((g) => g.items.map((i) => i.id))
    expect(ids).toContain(mine)
    expect(ids).not.toContain(theirs)
    const asB = (await call(b, 'GET', `/api/search?q=${name}`)).json().data as Array<{ items: Array<{ id: string }> }>
    expect(asB.flatMap((g) => g.items.map((i) => i.id))).toContain(theirs)
  })
})

describe('a visible prospect that is not the agent’s', () => {
  it('answers 403 on every write route, but a note can be written', async () => {
    const responses = await Promise.all([
      call(a, 'PATCH', `/api/prospects/${free}`, { name: 'x' }),
      call(a, 'POST', `/api/prospects/${free}/people`, { name: 'Ion' }),
      call(a, 'POST', `/api/prospects/${free}/contact-points`, { kind: 'phone', value: '0722 000 111' }),
      call(a, 'POST', `/api/prospects/${free}/tasks`, { kind: 'call', title: 'x', dueAt: new Date().toISOString() }),
      call(a, 'DELETE', `/api/prospects/${free}`),
    ])
    expect(responses.map((r) => r.statusCode), responses.map((r) => r.body).join('\n')).toEqual([403, 403, 403, 403, 403])
    // B sees everything but owns only `theirs`.
    expect((await call(b, 'PATCH', `/api/prospects/${mine}`, { name: 'x' })).statusCode).toBe(403)

    const note = await call(a, 'POST', `/api/prospects/${free}/notes`, { body: 'Called, no answer' })
    expect(note.statusCode, note.body).toBe(201)
  })

  it('claim: 409 on a prospect somebody has, also when the agent cannot see it; 200 on a free one', async () => {
    const taken = await call(a, 'POST', `/api/prospects/${theirs}/claim`)
    expect(taken.statusCode, taken.body).toBe(409)
    expect(taken.json().error.code).toBe('PROSPECT_TAKEN')
    expect((await call(b, 'POST', `/api/prospects/${mine}/claim`)).statusCode).toBe(409)
    expect((await call(a, 'POST', `/api/prospects/${free}/claim`)).statusCode).toBe(200)
    expect((await call(a, 'PATCH', `/api/prospects/${free}`, { name: `QAAC ${RUN} free` })).statusCode).toBe(200)
  })

  it('transfer: what is not the agent’s is skipped, not moved, and nothing is changed', async () => {
    const res = await call(a, 'POST', '/api/prospects/transfer', { ids: [theirs], toUserId: a.id })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().data).toMatchObject({ transferred: 0, skipped: [{ id: theirs }] })
    const [row] = await db.select().from(prospects).where(eq(prospects.id, theirs))
    expect(row!.assignedUserId).toBe(b.id)
  })
})

describe('rights the routes ask for beyond the catalog', () => {
  it('export: 403 without clienti.export, a file and an audit row with it', async () => {
    const name = encodeURIComponent(`QAAC ${RUN}`)
    expect((await call(a, 'GET', `/api/prospects/export?q=${name}&format=csv`)).statusCode).toBe(403)

    const ok = await call(b, 'GET', `/api/prospects/export?q=${name}&format=csv`)
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.headers['content-disposition']).toContain('attachment')
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.action, 'prospect.export'), eq(auditLog.actorUserId, b.id)))
    expect(audit).toHaveLength(1)
    // The export right alone is not enough to see prospects: the list rules still apply.
    const only = await call(exporter, 'GET', `/api/prospects/export?q=${name}&format=csv`)
    expect(only.statusCode).toBe(200)
    expect(only.body).not.toContain('theirs')
  })

  it('promote: 403 without facturi.clienti even for the owner', async () => {
    const res = await call(a, 'POST', `/api/prospects/${mine}/promote`, { address: 'Str. 1' })
    expect(res.statusCode, res.body).toBe(403)
    const [row] = await db.select().from(prospects).where(eq(prospects.id, mine))
    expect(row!.billingClientId).toBeNull()
  })

  it('?f= with an unknown field, an unknown operator or broken JSON answers 400', async () => {
    const get = (raw: string) => call(a, 'GET', `/api/prospects?f=${encodeURIComponent(raw)}`)
    expect((await get(JSON.stringify([{ field: 'password', op: 'in', value: ['x'] }]))).statusCode).toBe(400)
    expect((await get(JSON.stringify([{ field: 'status', op: 'like', value: ['x'] }]))).statusCode).toBe(400)
    expect((await get('[{"field":')).statusCode).toBe(400)
    expect((await call(a, 'GET', `/api/prospects/count?f=${encodeURIComponent('{"nope":1}')}`)).statusCode).toBe(400)
  })

  it('the phrase search answers 403 without asistent.view', async () => {
    const res = await call(a, 'POST', '/api/prospects/nl-filters', { text: 'firme din Brasov' })
    expect(res.statusCode, res.body).toBe(403)
    expect(res.json().error.code).toBe('ASSISTANT_FORBIDDEN')
  })
})
