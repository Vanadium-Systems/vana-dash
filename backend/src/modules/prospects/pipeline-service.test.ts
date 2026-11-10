/**
 * Integration test on a real Postgres (test/setup.ts): board, forecast, funnel and per-agent numbers.
 * Every prospect is named "QAPL ..." and every call filters on that name, so rows of other tests don't count.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, prospectStageEvents, prospects, prospectStatuses, prospectTasks } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { getBoard, getBoardColumn, getForecast, getFunnel, getStatsByAgent } from './pipeline-service.js'
import { listProspects } from './service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const STATUSES = ['qapl_s1', 'qapl_s2', 'qapl_s3', 'qapl_won', 'qapl_lost'] as const
const AGENT = ['clienti.view', 'clienti.prospectare']
const q = 'QAPL'

let ana: SessionUser
let bob: SessionUser
let dave: SessionUser
let manager: SessionUser

const newProspect = async (name: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `QAPL ${name}`, ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}
const event = (prospectId: string, toStatus: string, changedAt = new Date()) =>
  db.insert(prospectStageEvents).values({ prospectId, toStatus, changedAt })
const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
const column = async (me: SessionUser, status: string, cardLimit?: number) => {
  const board = await getBoard(me, { f: [], q }, cardLimit)
  return board.columns.find((c) => c.status === status)!
}

beforeAll(async () => {
  ana = await createTestUser('ana', userIds, { features: AGENT })
  bob = await createTestUser('bob', userIds, { features: AGENT })
  dave = await createTestUser('dave', userIds, { features: AGENT })
  manager = await createTestUser('manager', userIds, { features: [...AGENT, 'clienti.toti', 'clienti.repartizare'] })
  await db.insert(prospectStatuses).values(
    STATUSES.map((key, i) => ({
      key,
      label: key,
      colorToken: 'slate',
      sortOrder: 9000 + i,
      kind: key === 'qapl_won' ? ('won' as const) : key === 'qapl_lost' ? ('lost' as const) : ('open' as const),
    })),
  )
})

afterAll(async () => {
  if (prospectIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
    await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  }
  await db.delete(prospectStatuses).where(inArray(prospectStatuses.key, [...STATUSES]))
  await cleanupTestUsers(userIds)
})

describe('board', () => {
  it('gives the same count per stage as the list, and sums per currency', async () => {
    await newProspect('b1', { status: 'qapl_s1', valueAmount: '100', valueCurrency: 'RON' })
    await newProspect('b2', { status: 'qapl_s1', valueAmount: '50', valueCurrency: 'EUR' })
    await newProspect('b3', { status: 'qapl_s1', valueAmount: '25', valueCurrency: 'RON' })
    await newProspect('b4', { status: 'qapl_s1' })
    await newProspect('b5', { status: 'qapl_s2' })

    const filter = [{ field: 'status' as const, op: 'in' as const, value: ['qapl_s1'] }]
    const list = await listProspects(manager, { f: filter, q })
    const col = await column(manager, 'qapl_s1')
    expect(col.count).toBe(list.total)
    expect(col.count).toBe(4)
    expect(col.sums).toEqual(expect.arrayContaining([{ currency: 'RON', amount: 125 }, { currency: 'EUR', amount: 50 }]))
    expect(col.sums).toHaveLength(2)
    expect((await column(manager, 'qapl_s2')).count).toBe(1)
  })

  it('lists the won and lost stages too, in catalog order', async () => {
    const board = await getBoard(manager, { f: [], q })
    const keys = board.columns.map((c) => c.status)
    expect(keys.indexOf('qapl_s1')).toBeLessThan(keys.indexOf('qapl_s3'))
    expect(board.columns.find((c) => c.status === 'qapl_won')?.kind).toBe('won')
    expect(board.columns.find((c) => c.status === 'qapl_lost')?.kind).toBe('lost')
  })

  it('an agent without clienti.toti does not see another agent’s prospect', async () => {
    await newProspect('own-ana', { status: 'qapl_s3', assignedUserId: ana.id })
    await newProspect('own-bob', { status: 'qapl_s3', assignedUserId: bob.id })
    expect((await column(ana, 'qapl_s3')).count).toBe(1)
    expect((await column(manager, 'qapl_s3')).count).toBe(2)
  })

  it('caps the cards per column and pages the rest', async () => {
    for (let i = 0; i < 5; i++) await newProspect(`cap${i}`, { status: 'qapl_lost', score: String(i) })
    const col = await column(manager, 'qapl_lost', 3)
    expect(col.count).toBe(5)
    expect(col.cards).toHaveLength(3)
    expect(col.cards.map((c) => Number(c.score))).toEqual(['4', '3', '2'].map(Number))
    const next = await getBoardColumn(manager, { f: [], q, status: 'qapl_lost', page: 1 })
    expect(next.total).toBe(5)
    expect(next.cards).toHaveLength(5)
  })

  it('orders cards by the earliest open task, tasks-less last', async () => {
    const soon = await newProspect('t-soon', { status: 'qapl_won', score: '1' })
    const later = await newProspect('t-later', { status: 'qapl_won', score: '99' })
    const none = await newProspect('t-none', { status: 'qapl_won', score: '100' })
    const task = (prospectId: string, days: number) =>
      db.insert(prospectTasks).values({ prospectId, assigneeUserId: manager.id, kind: 'task', title: 't', dueAt: new Date(Date.now() + days * 86_400_000) })
    await task(soon, 1)
    await task(later, 5)
    const ids = (await column(manager, 'qapl_won')).cards.map((c) => c.id)
    expect(ids).toEqual([soon, later, none])
  })
})

describe('forecast', () => {
  it('puts overdue dates in the current month, undated apart, and skips lost', async () => {
    const f1 = await newProspect('f-past', { status: 'qapl_s1', expectedCloseAt: isoDay(-90), valueAmount: '10', valueCurrency: 'RON' })
    await newProspect('f-now', { status: 'qapl_s2', expectedCloseAt: isoDay(0), valueAmount: '5', valueCurrency: 'RON' })
    await newProspect('f-none', { status: 'qapl_s2' })
    await newProspect('f-lost', { status: 'qapl_lost', expectedCloseAt: isoDay(0), valueAmount: '999', valueCurrency: 'RON' })
    expect(f1).toBeTruthy()

    const forecast = await getForecast(manager, { f: [], q: 'QAPL f-', months: 3 })
    expect(forecast.months).toHaveLength(3)
    expect(forecast.months[0]!.count).toBe(2)
    expect(forecast.months[0]!.sums).toEqual([{ currency: 'RON', amount: 15 }])
    expect(forecast.months[1]).toMatchObject({ count: 0, sums: [] })
    expect(forecast.undated.count).toBe(1)
  })
})

describe('funnel', () => {
  it('counts a prospect that jumped ahead in the stages before it', async () => {
    const a = await newProspect('fn-a', { status: 'qapl_s1' })
    const b = await newProspect('fn-b', { status: 'qapl_s2' })
    const c = await newProspect('fn-c', { status: 'qapl_s3' })
    await event(a, 'qapl_s1')
    await event(b, 'qapl_s1')
    await event(b, 'qapl_s2')
    await event(c, 'qapl_s3')

    const { stages } = await getFunnel(manager, { f: [], q, from: isoDay(-1), to: isoDay(1) })
    const at = (key: string) => stages.find((s) => s.status === key)!
    expect(at('qapl_s1')).toMatchObject({ reached: 3 })
    expect(at('qapl_s2')).toMatchObject({ reached: 2, conversionFromPrevious: 0.667 })
    expect(at('qapl_s3')).toMatchObject({ reached: 1, conversionFromPrevious: 0.5 })
    expect(stages.some((s) => s.status === 'qapl_lost')).toBe(false)
  })

  it('ignores events outside the interval', async () => {
    const { stages } = await getFunnel(manager, { f: [], q, from: isoDay(-30), to: isoDay(-20) })
    expect(stages.find((s) => s.status === 'qapl_s1')!.reached).toBe(0)
  })
})

describe('stats by agent', () => {
  it('without repartizare there is one row, the person’s own', async () => {
    const rows = await getStatsByAgent(ana, { from: isoDay(-1), to: isoDay(1) })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.userId).toBe(ana.id)
  })

  it('counts claimed, no next step, won and a task finished today', async () => {
    const lead = await newProspect('st-lead', { status: 'qapl_s1', assignedUserId: dave.id })
    const deal = await newProspect('st-won', { status: 'qapl_won', assignedUserId: dave.id })
    await event(deal, 'qapl_won')
    await db.insert(prospectTasks).values({ prospectId: lead, assigneeUserId: dave.id, kind: 'call', title: 'x', dueAt: new Date(), doneAt: new Date() })

    const rows = await getStatsByAgent(manager, { from: isoDay(-1), to: isoDay(1) })
    const mine = rows.find((r) => r.userId === dave.id)!
    expect(mine.claimed).toBe(2)
    expect(mine.contactedToday).toBe(1)
    expect(mine.withoutNextStep).toBe(1)
    expect(mine.won).toBe(1)
    expect(rows.some((r) => r.userId === manager.id)).toBe(true)
    const names = rows.map((r) => r.name.toLowerCase())
    expect(names).toEqual([...names].sort())
  })
})

