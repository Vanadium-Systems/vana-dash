/** Integration test on a real Postgres: saved views, stars and the daily "new prospects" alert. */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { notifications, prospects, prospectViews, roles } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { CreateViewSchema } from './views-schema.js'
import * as views from './views-service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const viewIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

let ana: SessionUser
let bob: SessionUser

const newProspect = async (source: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `QA view ${source}`, source, ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}
const newView = async (me: SessionUser, input: Partial<Parameters<typeof views.createView>[1]> & { name: string }) => {
  const view = await views.createView(me, CreateViewSchema.parse(input))
  viewIds.push(view!.id)
  return view!
}

beforeAll(async () => {
  // Real role rows: the alert reloads the owner from the database, as the job does.
  ana = await createTestUser('ana', userIds, { roleKind: 'custom', features: AGENT })
  bob = await createTestUser('bob', userIds, { roleKind: 'custom', features: AGENT })
  for (const user of [ana, bob]) await db.update(roles).set({ features: AGENT }).where(eq(roles.id, user.role!.id))
})

afterAll(async () => {
  if (viewIds.length) await db.delete(prospectViews).where(inArray(prospectViews.id, viewIds))
  if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await cleanupTestUsers(userIds)
})

describe('views', () => {
  it('a shared view shows up for others, who cannot edit or delete it', async () => {
    const view = await newView(ana, { name: 'QA shared', shared: true })
    const seen = await views.listViews(bob)
    expect(seen.shared.find((v) => v.id === view.id)).toMatchObject({ isMine: false, ownerName: 'QA ana' })
    expect(await views.updateView(bob, view.id, { name: 'hijack' })).toBeUndefined()
    expect(await views.deleteView(bob, view.id)).toBe(false)
    expect((await views.listViews(ana)).mine.find((v) => v.id === view.id)?.name).toBe('QA shared')
  })

  it('a private view is invisible to others, also for stars', async () => {
    const view = await newView(ana, { name: 'QA private' })
    expect((await views.listViews(bob)).shared.find((v) => v.id === view.id)).toBeUndefined()
    expect(await views.starView(bob, view.id)).toBe(false)
  })

  it('stars a shared view and removes the star again', async () => {
    const view = await newView(ana, { name: 'QA starred', shared: true })
    expect(await views.starView(bob, view.id)).toBe(true)
    expect(await views.starView(bob, view.id)).toBe(true)
    let seen = await views.listViews(bob)
    expect(seen.starred.map((v) => v.id)).toContain(view.id)
    expect(seen.shared.find((v) => v.id === view.id)?.starred).toBe(true)
    expect((await views.listViews(ana)).starred.map((v) => v.id)).not.toContain(view.id)
    await views.unstarView(bob, view.id)
    seen = await views.listViews(bob)
    expect(seen.starred.map((v) => v.id)).not.toContain(view.id)
    expect(await views.starView(bob, view.id)).toBe(true)
  })

  it('soft-deletes for the owner', async () => {
    const view = await newView(ana, { name: 'QA gone', shared: true })
    expect(await views.deleteView(ana, view.id)).toBe(true)
    expect((await views.listViews(bob)).shared.find((v) => v.id === view.id)).toBeUndefined()
    expect(await views.deleteView(ana, view.id)).toBe(false)
  })

  it('refuses invalid filters, sort keys and calcs', () => {
    const bad = (extra: object) => CreateViewSchema.safeParse({ name: 'x', ...extra }).success
    expect(bad({ filters: [{ field: 'nope', op: 'in', value: ['a'] }] })).toBe(false)
    expect(bad({ filters: [{ field: 'status', op: 'like', value: ['a'] }] })).toBe(false)
    expect(bad({ sort: { key: 'password', dir: 'asc' } })).toBe(false)
    expect(bad({ calcs: { value: 'median' } })).toBe(false)
    expect(bad({ filters: [{ field: 'status', op: 'in', value: ['new'] }], sort: { key: 'score', dir: 'desc' }, calcs: { value: 'sum' } })).toBe(true)
  })

  it('creating with the alert on does not announce what already exists', async () => {
    const view = await newView(ana, { name: 'QA alert-on', notifyNew: true })
    const [row] = await db.select().from(prospectViews).where(eq(prospectViews.id, view.id))
    expect(row!.lastNotifiedAt).toBeTruthy()
  })
})

describe('view alerts', () => {
  it("counts only what the owner can see, created after the last alert, and moves the mark", async () => {
    const tag = `qa-alert-${crypto.randomUUID()}`
    await newProspect(tag, { createdAt: hoursAgo(48) }) // before the mark
    await newProspect(tag, { assignedUserId: bob.id }) // new, but bob's: ana has no clienti.toti
    await newProspect(tag) // new and free
    await newProspect(tag, { assignedUserId: ana.id }) // new and hers
    const view = await newView(ana, { name: 'QA alert', filters: [{ field: 'source', op: 'in', value: [tag] }], notifyNew: true })
    await db.update(prospectViews).set({ lastNotifiedAt: hoursAgo(1) }).where(eq(prospectViews.id, view.id))

    await views.runViewAlerts('ro')
    const bell = await db.select().from(notifications).where(and(eq(notifications.userId, ana.id), eq(notifications.kind, 'clienti.view_new'), eq(notifications.entityId, view.id)))
    expect(bell).toHaveLength(1)
    expect(bell[0]!.title).toContain('2 prospecți noi')
    expect(bell[0]!.title).toContain('QA alert')
    expect(bell[0]!.url).toBe(`/clients?view=${view.id}`)
    const [after] = await db.select().from(prospectViews).where(eq(prospectViews.id, view.id))
    expect(after!.lastNotifiedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000)

    await views.runViewAlerts('ro')
    expect(await db.select().from(notifications).where(and(eq(notifications.kind, 'clienti.view_new'), eq(notifications.entityId, view.id)))).toHaveLength(1)
  })

  it('stays quiet and still moves the mark when nothing is new; skips a deleted view', async () => {
    const tag = `qa-quiet-${crypto.randomUUID()}`
    const quiet = await newView(bob, { name: 'QA quiet', filters: [{ field: 'source', op: 'in', value: [tag] }], notifyNew: true })
    const gone = await newView(bob, { name: 'QA deleted', filters: [{ field: 'source', op: 'in', value: [tag] }], notifyNew: true })
    await db.update(prospectViews).set({ lastNotifiedAt: hoursAgo(5) }).where(inArray(prospectViews.id, [quiet.id, gone.id]))
    await views.deleteView(bob, gone.id)
    await newProspect(tag, { createdAt: hoursAgo(10) })
    await views.runViewAlerts('ro')
    expect(await db.select().from(notifications).where(and(eq(notifications.kind, 'clienti.view_new'), inArray(notifications.entityId, [quiet.id, gone.id])))).toHaveLength(0)
    const [q] = await db.select().from(prospectViews).where(eq(prospectViews.id, quiet.id))
    const [g] = await db.select().from(prospectViews).where(eq(prospectViews.id, gone.id))
    expect(q!.lastNotifiedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect(g!.lastNotifiedAt!.getTime()).toBeLessThan(Date.now() - 4 * 3_600_000)
  })
})
