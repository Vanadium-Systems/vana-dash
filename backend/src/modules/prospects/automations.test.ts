/**
 * The six fixed automation rules, on a real Postgres (test/setup.ts). Each handler is called directly
 * (the listeners are async), plus one test that an event reaches its handler. Prospects are named
 * "QAAU ..." and statuses "qaau_*"; the rules table is saved and put back, since it is the company's config.
 */
import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import {
  auditLog,
  emailSequenceEnrollments,
  emailSequences,
  notifications,
  prospectArchives,
  prospectAutomationRules,
  prospectListMembers,
  prospectLists,
  prospects,
  prospectStatuses,
  prospectTasks,
} from '../../shared/db/schema/index.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { emitProspectEvent } from '../../shared/lib/prospect-events.js'
import { wallClock } from '../../shared/lib/schedule-recurrence.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import {
  assertCanConfigureAutomations,
  AutomationForbiddenError,
  handleMeeting,
  handleProspectCreated,
  handleReply,
  handleStageChange,
  listAutomations,
  parseRuleParams,
  registerAutomationListeners,
  runNoNextStep,
  saveAutomation,
} from './automations-service.js'
import type { RuleKey } from './automations-schema.js'

const userIds: string[] = []
const prospectIds: string[] = []
const listIds: string[] = []
const sequenceIds: string[] = []
const STATUSES = ['qaau_open', 'qaau_meet', 'qaau_won'] as const
const DAY = 86_400_000

let owner: Awaited<ReturnType<typeof createTestUser>>
let admin: Awaited<ReturnType<typeof createTestUser>>
let savedRules: Array<typeof prospectAutomationRules.$inferSelect>

const newProspect = async (name: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `QAAU ${name}`, status: 'qaau_open', assignedUserId: owner.id, ...values }).returning()
  prospectIds.push(row!.id)
  return row!
}
const enable = (ruleKey: RuleKey, params: Record<string, unknown> = {}) => saveAutomation(ruleKey, true, parseRuleParams(ruleKey, params)!)
const tasksOf = (prospectId: string) => db.select().from(prospectTasks).where(eq(prospectTasks.prospectId, prospectId))
const auditOf = (prospectId: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, prospectId), eq(auditLog.action, 'prospect.automatizare')))
const bellsOf = (userId: string, kind: string) => db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.kind, kind)))

beforeAll(async () => {
  savedRules = await db.select().from(prospectAutomationRules)
  owner = await createTestUser('owner', userIds, { features: ['clienti.view', 'clienti.prospectare'] })
  admin = await createTestUser('admin', userIds, { roleKind: 'admin', features: [] })
  await db.insert(prospectStatuses).values(
    STATUSES.map((key, i) => ({ key, label: key, colorToken: 'slate', sortOrder: 9100 + i, kind: key === 'qaau_won' ? ('won' as const) : ('open' as const) })),
  )
  registerAutomationListeners()
})

afterEach(async () => {
  await db.delete(prospectAutomationRules)
  if (sequenceIds.length) await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds.splice(0)))
  if (prospectIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
    await db.delete(notifications).where(inArray(notifications.entityId, prospectIds))
    await db.delete(prospects).where(inArray(prospects.id, prospectIds.splice(0)))
  }
  if (listIds.length) await db.delete(prospectLists).where(inArray(prospectLists.id, listIds.splice(0)))
  await db.delete(notifications).where(inArray(notifications.userId, userIds))
})

afterAll(async () => {
  await db.delete(prospectAutomationRules)
  if (savedRules.length) await db.insert(prospectAutomationRules).values(savedRules)
  await db.delete(prospectStatuses).where(inArray(prospectStatuses.key, [...STATUSES]))
  await db.delete(auditLog).where(like(auditLog.action, 'prospect.automatizare%'))
  await cleanupTestUsers(userIds)
})

describe('config', () => {
  it('lists all six rules, off with default params when there is no row', async () => {
    const rules = await listAutomations()
    expect(rules.map((r) => r.ruleKey)).toEqual(['reply_call_task', 'bounce_notify', 'no_next_step', 'meeting_stage', 'won_cleanup', 'import_list'])
    expect(rules.every((r) => !r.enabled && r.lastRunAt === null)).toBe(true)
    expect(rules.find((r) => r.ruleKey === 'reply_call_task')!.params).toEqual({ hour: 10 })
    expect(rules.find((r) => r.ruleKey === 'import_list')!.params).toEqual({ listId: null, minScore: 65 })
  })

  it('refuses params that do not fit the rule', () => {
    expect(parseRuleParams('no_next_step', { days: 0 })).toBeNull()
    expect(parseRuleParams('no_next_step', { days: 91 })).toBeNull()
    expect(parseRuleParams('reply_call_task', { hour: 24 })).toBeNull()
    expect(parseRuleParams('import_list', { listId: 'nope' })).toBeNull()
    expect(parseRuleParams('bounce_notify', { extra: 1 })).toBeNull()
    expect(parseRuleParams('no_next_step', {})).toEqual({ days: 7 })
  })

  it('needs clienti.repartizare to change a rule', () => {
    expect(() => assertCanConfigureAutomations({ features: ['clienti.view', 'clienti.prospectare'] })).toThrow(AutomationForbiddenError)
    expect(() => assertCanConfigureAutomations({ features: ['clienti.repartizare'] })).not.toThrow()
  })

  it('writes the change to the audit log', async () => {
    await saveAutomation('no_next_step', true, { days: 3 })
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'prospect.automatizare.config')).orderBy(auditLog.createdAt).limit(1)
    expect(row?.changes).toMatchObject({ rule: [null, 'no_next_step'], enabled: [false, true] })
    await db.delete(auditLog).where(eq(auditLog.action, 'prospect.automatizare.config'))
  })
})

describe('reply_call_task', () => {
  it('does nothing while off', async () => {
    const p = await newProspect('off')
    expect(await handleReply({ prospectId: p.id, address: 'x@example.com' })).toBe(0)
    expect(await tasksOf(p.id)).toHaveLength(0)
    expect(await auditOf(p.id)).toHaveLength(0)
  })

  it('creates the call for tomorrow at the set hour in the company time zone', async () => {
    await enable('reply_call_task', { hour: 9 })
    const p = await newProspect('reply')
    const now = new Date('2026-11-30T23:30:00Z')
    expect(await handleReply({ prospectId: p.id, address: 'x@example.com' }, now)).toBe(1)
    const [task] = await tasksOf(p.id)
    expect(task).toMatchObject({ kind: 'call', assigneeUserId: owner.id, createdByUserId: null })
    expect(task!.title).toContain('QAAU reply')
    const timeZone = await getCompanyTimeZone()
    const today = wallClock(now, timeZone)
    const due = wallClock(task!.dueAt, timeZone)
    const expectedDay = new Date(Date.UTC(today.y, today.m - 1, today.d + 1))
    expect(due).toMatchObject({ y: expectedDay.getUTCFullYear(), m: expectedDay.getUTCMonth() + 1, d: expectedDay.getUTCDate(), h: 9, min: 0 })
    const [rule] = await listAutomations().then((r) => r.filter((x) => x.ruleKey === 'reply_call_task'))
    expect(rule).toMatchObject({ enabled: true, lastRunCount: 1 })
    expect(rule!.lastRunAt).toBeInstanceOf(Date)
  })

  it('writes the audit with via automation and no actor', async () => {
    await enable('reply_call_task')
    const p = await newProspect('audit')
    await handleReply({ prospectId: p.id, address: 'x@example.com' })
    const [row] = await auditOf(p.id)
    expect(row?.actorUserId).toBeNull()
    expect(row?.changes).toMatchObject({ via: [null, 'automation'], rule: [null, 'reply_call_task'] })
  })

  it('goes to the first active admin when the prospect is free, and ignores a reply with no prospect', async () => {
    await enable('reply_call_task')
    const free = await newProspect('free', { assignedUserId: null })
    expect(await handleReply({ prospectId: null, address: 'x@example.com' })).toBe(0)
    await handleReply({ prospectId: free.id, address: 'x@example.com' })
    const [task] = await tasksOf(free.id)
    expect(task?.assigneeUserId).toBeTruthy()
  })

  it('is reached by the email.replied event', async () => {
    await enable('reply_call_task')
    const p = await newProspect('event')
    emitProspectEvent('email.replied', { prospectId: p.id, address: 'x@example.com' })
    await vi.waitFor(async () => expect(await tasksOf(p.id)).toHaveLength(1))
  })
})

describe('no_next_step', () => {
  it('does nothing while off', async () => {
    await newProspect('idle', { claimedAt: new Date(Date.now() - 30 * DAY) })
    expect(await runNoNextStep()).toBe(0)
    expect(await bellsOf(owner.id, 'clienti.no_next_step')).toHaveLength(0)
  })

  it('sends one notification per person with the right count, skipping won, archived, recent and with a task', async () => {
    await enable('no_next_step', { days: 7 })
    const old = new Date(Date.now() - 10 * DAY)
    const a = await newProspect('a', { claimedAt: old })
    const b = await newProspect('b', { claimedAt: new Date(Date.now() - 20 * DAY), lastActivityAt: old })
    const withTask = await newProspect('task', { claimedAt: old })
    await newProspect('recent', { claimedAt: new Date() })
    await newProspect('won', { claimedAt: old, status: 'qaau_won' })
    const archived = await newProspect('archived', { claimedAt: old })
    await db.insert(prospectTasks).values({ prospectId: withTask.id, assigneeUserId: owner.id, kind: 'call', title: 'x', dueAt: new Date(Date.now() + DAY) })
    await db.insert(prospectArchives).values({ prospectId: archived.id, userId: owner.id })

    expect(await runNoNextStep()).toBe(2)
    const bells = await bellsOf(owner.id, 'clienti.no_next_step')
    expect(bells).toHaveLength(1)
    expect(bells[0]!.title).toContain('2')
    expect(decodeURIComponent(bells[0]!.url!)).toContain('"field":"nextTask"')
    expect(await auditOf(a.id)).toHaveLength(1)
    expect(await auditOf(b.id)).toHaveLength(1)
    expect(await auditOf(withTask.id)).toHaveLength(0)
    const rule = (await listAutomations()).find((r) => r.ruleKey === 'no_next_step')!
    expect(rule.lastRunCount).toBe(2)
  })
})

describe('meeting_stage', () => {
  it('does nothing while off', async () => {
    const p = await newProspect('off')
    expect(await handleMeeting({ prospectId: p.id, at: new Date(Date.now() + 5 * DAY) })).toBe(0)
    expect(await tasksOf(p.id)).toHaveLength(0)
  })

  it('moves to the stage and prepares the meeting a day before', async () => {
    await enable('meeting_stage', { status: 'qaau_meet' })
    const p = await newProspect('meet')
    const at = new Date(Date.now() + 5 * DAY)
    expect(await handleMeeting({ prospectId: p.id, at })).toBe(1)
    const [row] = await db.select({ status: prospects.status }).from(prospects).where(eq(prospects.id, p.id))
    expect(row?.status).toBe('qaau_meet')
    const [task] = await tasksOf(p.id)
    expect(task).toMatchObject({ kind: 'task', assigneeUserId: owner.id })
    expect(task!.dueAt.getTime()).toBe(at.getTime() - DAY)
    expect((await auditOf(p.id))[0]?.changes).toMatchObject({ status: ['qaau_open', 'qaau_meet'], via: [null, 'automation'] })
  })

  it('puts the task at now when the meeting is less than a day away', async () => {
    await enable('meeting_stage')
    const p = await newProspect('soon')
    const now = new Date()
    await handleMeeting({ prospectId: p.id, at: new Date(now.getTime() + 3_600_000) }, now)
    expect((await tasksOf(p.id))[0]!.dueAt.getTime()).toBe(now.getTime())
  })

  it('ignores a stage that does not exist but still makes the task', async () => {
    await enable('meeting_stage', { status: 'qaau_nope' })
    const p = await newProspect('nostage')
    await handleMeeting({ prospectId: p.id, at: new Date(Date.now() + 5 * DAY) })
    const [row] = await db.select({ status: prospects.status }).from(prospects).where(eq(prospects.id, p.id))
    expect(row?.status).toBe('qaau_open')
    expect(await tasksOf(p.id)).toHaveLength(1)
  })
})

describe('won_cleanup', () => {
  const enroll = async (prospectId: string) => {
    const [seq] = await db.insert(emailSequences).values({ name: 'QAAU seq', fromIdentity: 'contact', stopOnWonLost: false }).returning()
    sequenceIds.push(seq!.id)
    const [row] = await db
      .insert(emailSequenceEnrollments)
      .values({ sequenceId: seq!.id, prospectId, recipientEmail: 'qaau@example.com', recipientName: 'Ana' })
      .returning()
    return row!.id
  }
  const statusOfEnrollment = async (id: string) => (await db.select({ s: emailSequenceEnrollments.status }).from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, id)))[0]?.s

  it('does nothing while off, or for a stage that is not won', async () => {
    const p = await newProspect('off')
    const id = await enroll(p.id)
    expect(await handleStageChange({ prospectId: p.id, from: 'qaau_open', to: 'qaau_won', kind: 'won' })).toBe(0)
    await enable('won_cleanup')
    expect(await handleStageChange({ prospectId: p.id, from: 'qaau_open', to: 'qaau_meet', kind: 'open' })).toBe(0)
    expect(await statusOfEnrollment(id)).toBe('active')
  })

  it('stops the enrollments whatever the sequence says, and tells the admins', async () => {
    await enable('won_cleanup')
    const p = await newProspect('won', { status: 'qaau_won' })
    const id = await enroll(p.id)
    expect(await handleStageChange({ prospectId: p.id, from: 'qaau_open', to: 'qaau_won', kind: 'won' })).toBe(1)
    expect(await statusOfEnrollment(id)).toBe('won_lost')
    const bells = await db.select().from(notifications).where(and(eq(notifications.entityId, p.id), eq(notifications.userId, admin.id)))
    expect(bells).toHaveLength(1)
    expect(bells[0]!.title).toContain('QAAU won')
  })

  it('does not notify when the prospect already has a client', async () => {
    await enable('won_cleanup')
    const { billingClients } = await import('../../shared/db/schema/index.js')
    const [client] = await db.insert(billingClients).values({ name: 'QAAU Client', cif: `QAAU${Date.now()}`, address: 'x' }).returning()
    try {
      const p = await newProspect('client', { status: 'qaau_won', billingClientId: client!.id })
      const id = await enroll(p.id)
      await handleStageChange({ prospectId: p.id, from: 'qaau_open', to: 'qaau_won', kind: 'won' })
      expect(await statusOfEnrollment(id)).toBe('won_lost')
      expect(await db.select().from(notifications).where(eq(notifications.entityId, p.id))).toHaveLength(0)
    } finally {
      await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds.splice(0)))
      await db.delete(prospects).where(eq(prospects.billingClientId, client!.id))
      await db.delete(billingClients).where(eq(billingClients.id, client!.id))
    }
  })
})

describe('import_list', () => {
  const makeList = async () => {
    const [list] = await db.insert(prospectLists).values({ name: 'QAAU list', ownerUserId: owner.id }).returning()
    listIds.push(list!.id)
    return list!.id
  }
  const members = (listId: string) => db.select().from(prospectListMembers).where(eq(prospectListMembers.listId, listId))

  it('does nothing while off, without a list, or for a manual prospect', async () => {
    const listId = await makeList()
    const p = await newProspect('off', { score: '90' })
    expect(await handleProspectCreated({ prospectId: p.id, via: 'import' })).toBe(0)
    await enable('import_list', {})
    expect(await handleProspectCreated({ prospectId: p.id, via: 'import' })).toBe(0)
    await enable('import_list', { listId })
    expect(await handleProspectCreated({ prospectId: p.id, via: 'manual' })).toBe(0)
    expect(await members(listId)).toHaveLength(0)
  })

  it('adds only from the minimum score up', async () => {
    const listId = await makeList()
    await enable('import_list', { listId, minScore: 65 })
    const low = await newProspect('low', { score: '64.9' })
    const high = await newProspect('high', { score: '65' })
    const unscored = await newProspect('unscored')
    expect(await handleProspectCreated({ prospectId: low.id, via: 'import' })).toBe(0)
    expect(await handleProspectCreated({ prospectId: unscored.id, via: 'import' })).toBe(0)
    expect(await handleProspectCreated({ prospectId: high.id, via: 'import' })).toBe(1)
    expect((await members(listId)).map((m) => m.prospectId)).toEqual([high.id])
    expect((await auditOf(high.id))[0]?.changes).toMatchObject({ listId: [null, listId], via: [null, 'automation'] })
    expect(await auditOf(low.id)).toHaveLength(0)
  })
})
