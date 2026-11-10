/**
 * Integration test on a real Postgres (test/setup.ts): every filter field with its operators, through the
 * list. Each prospect is named "QAFL ..." and every call searches that name, so rows of other tests don't count.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import {
  emailSends,
  emailSequenceEnrollments,
  emailSequences,
  prospectArchives,
  prospectContactPoints,
  prospectListMembers,
  prospectLists,
  prospectPeople,
  prospects,
  prospectSignalHits,
  prospectSignals,
  prospectTasks,
} from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { FILTER_FIELDS, ProspectFilterSchema, type ProspectFilter } from './filters.js'
import { listProspects } from './service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const sequenceIds: string[] = []
const listIds: string[] = []
const signalIds: string[] = []
const sendIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']
const q = 'QAFL'
const HOUR = 3_600_000

let manager: SessionUser
let ana: SessionUser
let p1: string
let p2: string
let p3: string
let sequenceId: string
let listId: string
let signalId: string

const newProspect = async (name: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `QAFL ${name}`, ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}
const point = (prospectId: string, kind: 'phone' | 'email', value: string, status: 'ok' | 'invalid' | 'unsubscribed' | 'bounced' = 'ok') =>
  db.insert(prospectContactPoints).values({ prospectId, kind, value, valueNormalized: value, status })
const task = (prospectId: string, dueAt: Date) =>
  db.insert(prospectTasks).values({ prospectId, assigneeUserId: ana.id, kind: 'call', title: 'QAFL task', dueAt })
const found = async (f: ProspectFilter[], me = manager) =>
  (await listProspects(me, { f, q, pageSize: 100 })).rows.map((r) => (r as { id: string }).id).sort()
const expectIds = async (f: ProspectFilter[], expected: string[]) => expect(await found(f)).toEqual([...expected].sort())

beforeAll(async () => {
  manager = await createTestUser('manager', userIds, { features: [...AGENT, 'clienti.toti'] })
  ana = await createTestUser('ana', userIds, { features: AGENT })

  p1 = await newProspect('one', {
    status: 'contactat', assignedUserId: ana.id, score: '80', source: 'qafl-src', caenCode: '3811', employeeCount: 10, revenue: '1000',
    valueAmount: '500', expectedCloseAt: '2030-01-15', lastActivityAt: new Date(Date.now() - 48 * HOUR), createdAt: new Date('2025-03-01T10:00:00Z'),
    foundingYear: 2020, isActive: false,
  })
  p2 = await newProspect('two', {
    status: 'necontactat', score: '40', caenCode: '3821', employeeCount: 50, revenue: '5000', createdAt: new Date('2025-06-01T10:00:00Z'), foundingYear: 2010, isActive: true,
  })
  p3 = await newProspect('three', { status: 'contactat', assignedUserId: manager.id, source: 'qafl-other', createdAt: new Date('2025-09-01T10:00:00Z') })

  await point(p1, 'phone', '+40722990001')
  await point(p2, 'email', 'two@example.com')
  await point(p3, 'phone', '+40722990003', 'invalid')
  await point(p3, 'email', 'three@example.com', 'unsubscribed')
  await db.insert(prospectPeople).values([
    { prospectId: p1, name: 'Ion', role: 'Director general', isDecisionMaker: true },
    { prospectId: p2, name: 'Maria', role: 'Contabil', doNotContact: true },
  ])
  await task(p1, new Date(Date.now() - 48 * HOUR))
  await task(p2, new Date(Date.now() + 72 * HOUR))

  const [list] = await db.insert(prospectLists).values({ ownerUserId: manager.id, name: 'QAFL list' }).returning()
  listId = list!.id
  listIds.push(listId)
  await db.insert(prospectListMembers).values({ listId, prospectId: p1 })

  const [sequence] = await db.insert(emailSequences).values({ name: 'QAFL seq', fromIdentity: 'qafl@test.local' }).returning()
  sequenceId = sequence!.id
  sequenceIds.push(sequenceId)
  await db.insert(emailSequenceEnrollments).values([
    { sequenceId, prospectId: p1, recipientEmail: 'one@example.com' },
    { sequenceId, prospectId: p2, recipientEmail: 'two@example.com', status: 'replied' },
  ])
  await point(p1, 'email', 'one@example.com')
  const sends = await db
    .insert(emailSends)
    .values([
      { recipient: 'one@example.com', subject: 'QAFL', status: 'delivered', openedAt: new Date(), clickedAt: new Date() },
      { recipient: 'three@example.com', subject: 'QAFL', status: 'bounced' },
    ])
    .returning()
  sendIds.push(...sends.map((s) => s.id))

  const [signal] = await db.insert(prospectSignals).values({ name: 'QAFL signal', groupKey: 'qafl', filters: [] }).returning()
  signalId = signal!.id
  signalIds.push(signalId)
  await db.insert(prospectSignalHits).values({ signalId, prospectId: p2, computedAt: new Date() })

  await db.insert(prospectArchives).values({ prospectId: p3, userId: manager.id })
})

afterAll(async () => {
  if (sendIds.length) await db.delete(emailSends).where(inArray(emailSends.id, sendIds))
  if (sequenceIds.length) await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds))
  if (listIds.length) await db.delete(prospectLists).where(inArray(prospectLists.id, listIds))
  if (signalIds.length) await db.delete(prospectSignals).where(inArray(prospectSignals.id, signalIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await cleanupTestUsers(userIds)
})

describe('filter fields', () => {
  it('status and source: in, not_in, and is_empty on source', async () => {
    await expectIds([{ field: 'status', op: 'in', value: ['contactat'] }, { field: 'archived', op: 'in', value: ['any'] }], [p1, p3])
    await expectIds([{ field: 'status', op: 'not_in', value: ['contactat'] }], [p2])
    await expectIds([{ field: 'source', op: 'in', value: ['qafl-src'] }], [p1])
    await expectIds([{ field: 'source', op: 'not_in', value: ['qafl-src'] }], [p2])
    await expectIds([{ field: 'source', op: 'is_empty' }], [p2])
    await expectIds([{ field: 'source', op: 'not_empty' }, { field: 'archived', op: 'in', value: ['any'] }], [p1, p3])
  })

  it('owner: me, free, a person, not_in and is_empty', async () => {
    await expectIds([{ field: 'owner', op: 'in', value: [ana.id] }], [p1])
    await expectIds([{ field: 'owner', op: 'in', value: ['free'] }], [p2])
    await expectIds([{ field: 'owner', op: 'in', value: ['me'] }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'owner', op: 'is_empty' }], [p2])
    await expectIds([{ field: 'owner', op: 'not_empty' }], [p1])
  })

  it('priority, caen prefix and numeric fields: between, is_empty, not_empty', async () => {
    await expectIds([{ field: 'priority', op: 'in', value: ['HOT'] }], [p1])
    await expectIds([{ field: 'priority', op: 'not_in', value: ['HOT'] }], [p2])
    await expectIds([{ field: 'score', op: 'between', value: [50, null] }], [p1])
    await expectIds([{ field: 'score', op: 'between', value: [null, 50] }], [p2])
    await expectIds([{ field: 'caen', op: 'in', value: ['38'] }], [p1, p2])
    await expectIds([{ field: 'caen', op: 'in', value: ['3811'] }], [p1])
    await expectIds([{ field: 'caen', op: 'not_in', value: ['3811'] }], [p2])
    await expectIds([{ field: 'caen', op: 'is_empty' }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'employees', op: 'between', value: [20, 100] }], [p2])
    await expectIds([{ field: 'employees', op: 'is_empty' }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'revenue', op: 'between', value: [2000, null] }], [p2])
    await expectIds([{ field: 'revenue', op: 'not_empty' }], [p1, p2])
    await expectIds([{ field: 'value', op: 'between', value: [100, 1000] }], [p1])
    await expectIds([{ field: 'value', op: 'is_empty' }], [p2])
    await expectIds([{ field: 'foundingYear', op: 'between', value: [2015, null] }], [p1])
    await expectIds([{ field: 'foundingYear', op: 'is_empty' }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
  })

  it('dates: expectedCloseAt, createdAt and lastActivityAt (between, is_empty, not_empty)', async () => {
    await expectIds([{ field: 'expectedCloseAt', op: 'between', value: ['2030-01-01', '2030-01-31'] }], [p1])
    await expectIds([{ field: 'expectedCloseAt', op: 'is_empty' }], [p2])
    await expectIds([{ field: 'createdAt', op: 'between', value: ['2025-05-01', '2025-07-01'] }], [p2])
    await expectIds([{ field: 'createdAt', op: 'between', value: ['2025-08-01', null] }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'lastActivityAt', op: 'not_empty' }], [p1])
    await expectIds([{ field: 'lastActivityAt', op: 'is_empty' }], [p2])
    // Activity in the last day: p1's last activity was two days ago.
    await expectIds([{ field: 'lastActivityAt', op: 'between', value: [new Date(Date.now() - 24 * HOUR).toISOString(), null] }], [])
    await expectIds([{ field: 'lastActivityAt', op: 'between', value: [new Date(Date.now() - 72 * HOUR).toISOString(), null] }], [p1])
  })

  it('nextTask: overdue, future and none, with in and not_in', async () => {
    await expectIds([{ field: 'nextTask', op: 'in', value: ['overdue'] }], [p1])
    await expectIds([{ field: 'nextTask', op: 'in', value: ['future'] }], [p2])
    await expectIds([{ field: 'nextTask', op: 'in', value: ['none'] }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'nextTask', op: 'not_in', value: ['none'] }], [p1, p2])
    await expectIds([{ field: 'nextTask', op: 'in', value: ['nonsense'] }], [])
  })

  it('list and sequence: a member, not_in, is_empty and not_empty', async () => {
    await expectIds([{ field: 'list', op: 'in', value: [listId] }], [p1])
    await expectIds([{ field: 'list', op: 'not_in', value: [listId] }], [p2])
    await expectIds([{ field: 'list', op: 'not_empty' }], [p1])
    await expectIds([{ field: 'list', op: 'is_empty' }], [p2])
    await expectIds([{ field: 'sequence', op: 'in', value: [sequenceId] }], [p1])
    // p2's enrollment is 'replied', so only active enrollments count.
    await expectIds([{ field: 'sequence', op: 'not_in', value: [sequenceId] }], [p2])
    await expectIds([{ field: 'sequence', op: 'not_empty' }], [p1])
    await expectIds([{ field: 'sequence', op: 'is_empty' }], [p2])
    await expectIds([{ field: 'list', op: 'in', value: ['not-a-uuid'] }], [])
  })

  it('emailEvent: opened, clicked, bounced, replied and unsubscribed', async () => {
    const all = { field: 'archived' as const, op: 'in' as const, value: ['any'] }
    await expectIds([{ field: 'emailEvent', op: 'in', value: ['opened'] }], [p1])
    await expectIds([{ field: 'emailEvent', op: 'in', value: ['clicked'] }], [p1])
    await expectIds([{ field: 'emailEvent', op: 'in', value: ['bounced'] }, all], [p3])
    await expectIds([{ field: 'emailEvent', op: 'in', value: ['replied'] }], [p2])
    await expectIds([{ field: 'emailEvent', op: 'in', value: ['unsubscribed'] }, all], [p3])
    await expectIds([{ field: 'emailEvent', op: 'not_in', value: ['opened'] }, all], [p2, p3])
  })

  it('isActive, signal and archived', async () => {
    await expectIds([{ field: 'isActive', op: 'in', value: ['false'] }], [p1])
    await expectIds([{ field: 'isActive', op: 'in', value: ['true'] }], [p2])
    await expectIds([{ field: 'isActive', op: 'not_in', value: ['true'] }], [p1])
    await expectIds([{ field: 'signal', op: 'in', value: [signalId] }], [p2])
    await expectIds([{ field: 'signal', op: 'not_in', value: [signalId] }], [p1])
    // Archiving is per person: my archived prospect is hidden unless asked for.
    await expectIds([{ field: 'archived', op: 'in', value: ['yes'] }], [p3])
    await expectIds([{ field: 'archived', op: 'in', value: ['any'] }], [p1, p2, p3])
    await expectIds([], [p1, p2])
    expect(await found([{ field: 'archived', op: 'in', value: ['yes'] }], ana)).toEqual([])
  })

  it('phone, email and contactStatus count only points that are ok', async () => {
    await expectIds([{ field: 'phone', op: 'not_empty' }], [p1])
    await expectIds([{ field: 'phone', op: 'is_empty' }], [p2])
    await expectIds([{ field: 'email', op: 'not_empty' }], [p1, p2])
    await expectIds([{ field: 'email', op: 'is_empty' }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'contactStatus', op: 'in', value: ['unsubscribed'] }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'contactStatus', op: 'in', value: ['invalid'] }, { field: 'archived', op: 'in', value: ['any'] }], [p3])
    await expectIds([{ field: 'contactStatus', op: 'not_in', value: ['unsubscribed', 'invalid'] }], [p1, p2])
  })

  it('people.role, people.decisionMaker and people.doNotContact', async () => {
    await expectIds([{ field: 'people.role', op: 'in', value: ['director'] }], [p1])
    await expectIds([{ field: 'people.role', op: 'not_in', value: ['director'] }], [p2])
    await expectIds([{ field: 'people.role', op: 'not_empty' }], [p1, p2])
    await expectIds([{ field: 'people.decisionMaker', op: 'not_empty' }], [p1])
    await expectIds([{ field: 'people.doNotContact', op: 'not_empty' }], [p2])
    await expectIds([{ field: 'people.doNotContact', op: 'is_empty' }], [p1])
  })

  it('has a case for every field, and an unknown field is refused by the schema', () => {
    for (const field of FILTER_FIELDS) expect(ProspectFilterSchema.safeParse({ field, op: 'not_empty' }).success).toBe(true)
    expect(ProspectFilterSchema.safeParse({ field: 'password', op: 'not_empty' }).success).toBe(false)
  })

  it('owner not_in keeps the free prospects', async () => {
    await expectIds([{ field: 'owner', op: 'not_in', value: [ana.id] }], [p2])
    const stranger = await createTestUser('stranger-not-in', userIds, { features: AGENT })
    expect(await found([{ field: 'owner', op: 'not_in', value: ['me'] }], stranger)).toEqual([p2])
  })

  it('the filters and the owner of the list together cannot show a colleague’s prospect to an agent', async () => {
    const stranger = await createTestUser('stranger', userIds, { features: AGENT })
    await expectIds([], [p1, p2])
    expect(await found([{ field: 'owner', op: 'in', value: [ana.id] }], stranger)).toEqual([])
  })
})
