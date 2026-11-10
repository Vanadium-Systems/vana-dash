/**
 * Integration test on a real Postgres (test/setup.ts): people, contact points, notes and tasks
 * of a prospect, with agent A (own prospects only), B (`clienti.toti`) and a manager
 * (`clienti.repartizare`); plus the shared snippets.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { prospectContactPoints, prospects, roles } from '../../shared/db/schema/index.js'
import { onProspectEvent } from '../../shared/lib/prospect-events.js'
import { ProspectNotYoursError } from '../../shared/lib/prospect-access.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import * as snippets from '../snippets/service.js'
import * as crm from './crm-service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']
const DAY = 24 * 60 * 60 * 1000

let a: SessionUser
let b: SessionUser
let manager: SessionUser
let mine: string
let theirs: string
let free: string

beforeAll(async () => {
  a = await createTestUser('crm-a', userIds, { features: AGENT })
  b = await createTestUser('crm-b', userIds, { features: [...AGENT, 'clienti.toti'] })
  manager = await createTestUser('crm-manager', userIds, { features: [...AGENT, 'clienti.toti', 'clienti.repartizare'] })
  const rows = await db
    .insert(prospects)
    .values([{ name: 'QA CRM Mine SRL', assignedUserId: a.id }, { name: 'QA CRM Theirs SRL', assignedUserId: b.id }, { name: 'QA CRM Free SRL' }])
    .returning()
  const ids = rows.map((r) => r.id)
  prospectIds.push(...ids)
  mine = ids[0]!
  theirs = ids[1]!
  free = ids[2]!
})

afterAll(async () => {
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await cleanupTestUsers(userIds)
})

describe('edit rights', () => {
  it('agent cannot add a person, contact point or task on a free prospect', async () => {
    await expect(crm.createPerson(a, free, { name: 'Ion' })).rejects.toBeInstanceOf(ProspectNotYoursError)
    await expect(crm.createContactPoint(a, free, { kind: 'phone', value: '0722 111 222' })).rejects.toBeInstanceOf(ProspectNotYoursError)
    await expect(crm.createProspectTask(a, free, { kind: 'task', title: 'x', dueAt: new Date() })).rejects.toBeInstanceOf(ProspectNotYoursError)
  })

  it('a prospect the agent cannot see answers undefined everywhere', async () => {
    expect(await crm.listPeople(a, theirs)).toBeUndefined()
    expect(await crm.createPerson(a, theirs, { name: 'Ion' })).toBeUndefined()
    expect(await crm.createNote(a, theirs, { body: 'hi' })).toBeUndefined()
    expect(await crm.listNotes(a, theirs)).toBeUndefined()
    expect(await crm.createProspectTask(a, theirs, { kind: 'task', title: 'x', dueAt: new Date() })).toBeUndefined()
  })

  it('agent can write a note on a free visible prospect', async () => {
    const note = await crm.createNote(a, free, { body: 'seen at a fair' })
    expect(note?.authorUserId).toBe(a.id)
    const [row] = await db.select({ lastActivityAt: prospects.lastActivityAt }).from(prospects).where(eq(prospects.id, free))
    expect(row?.lastActivityAt).not.toBeNull()
  })
})

describe('people and contact points', () => {
  it('rejects the same phone written two ways', async () => {
    await crm.createContactPoint(a, mine, { kind: 'phone', value: '0722 000 111' })
    await expect(crm.createContactPoint(a, mine, { kind: 'phone', value: '0722000111' })).rejects.toBeInstanceOf(crm.ContactExistsError)
  })

  it('keeps one primary per kind and owner', async () => {
    const first = await crm.createContactPoint(a, mine, { kind: 'email', value: 'one@example.com', isPrimary: true })
    const second = await crm.createContactPoint(a, mine, { kind: 'email', value: 'two@example.com', isPrimary: true })
    const rows = await db
      .select({ id: prospectContactPoints.id, isPrimary: prospectContactPoints.isPrimary })
      .from(prospectContactPoints)
      .where(and(eq(prospectContactPoints.prospectId, mine), eq(prospectContactPoints.kind, 'email')))
    expect(rows.find((r) => r.id === first!.id)?.isPrimary).toBe(false)
    expect(rows.find((r) => r.id === second!.id)?.isPrimary).toBe(true)
  })

  it('refuses a contact point attached to a person of another prospect', async () => {
    const person = await crm.createPerson(a, mine, { name: 'Maria', isDecisionMaker: true })
    await expect(crm.createContactPoint(a, mine, { kind: 'email', value: 'm@example.com', personId: person!.id })).resolves.toBeDefined()
    const [other] = await db.insert(prospects).values({ name: 'QA CRM Other SRL', assignedUserId: a.id }).returning()
    prospectIds.push(other!.id)
    await expect(crm.createContactPoint(a, other!.id, { kind: 'email', value: 'x@example.com', personId: person!.id })).rejects.toBeInstanceOf(crm.ForeignRefError)
  })
})

describe('notes', () => {
  it('only the author edits or deletes a note', async () => {
    const note = await crm.createNote(a, mine, { body: 'mine' })
    await expect(crm.updateNote(b, mine, note!.id, { body: 'changed' })).rejects.toBeInstanceOf(crm.NoteNotYoursError)
    await expect(crm.deleteNote(b, mine, note!.id)).rejects.toBeInstanceOf(crm.NoteNotYoursError)
    expect((await crm.updateNote(a, mine, note!.id, { body: 'edited' }))?.body).toBe('edited')
  })

  it('keeps one pinned note, listed first', async () => {
    const n1 = await crm.createNote(a, mine, { body: 'first', pinned: true })
    const n2 = await crm.createNote(a, mine, { body: 'second', pinned: true })
    const notes = (await crm.listNotes(a, mine))!
    expect(notes.filter((n) => n.pinned).map((n) => n.id)).toEqual([n2!.id])
    expect(notes[0]?.id).toBe(n2!.id)
    expect(notes.find((n) => n.id === n1!.id)?.pinned).toBe(false)
    expect(notes[0]?.authorName).toBe('QA crm-a')
  })

  it('keeps only the mentioned people who can see the prospect', async () => {
    const admin = await createTestUser('crm-admin', userIds, { roleKind: 'admin' })
    const outsider = await createTestUser('crm-outsider', userIds, { roleKind: 'custom' })
    await db.update(roles).set({ features: ['clienti.view'] }).where(eq(roles.id, outsider.role!.id))
    const note = await crm.createNote(a, mine, { body: '@both', mentions: [admin.id, outsider.id, admin.id, crypto.randomUUID()] })
    expect(note?.mentions).toEqual([admin.id])
  })
})

describe('tasks', () => {
  it('"done" with a wrong number invalidates the point and creates the follow-up together', async () => {
    const point = await crm.createContactPoint(a, mine, { kind: 'phone', value: '0733 555 000' })
    const task = await crm.createProspectTask(a, mine, { kind: 'call', title: 'Call Maria', dueAt: new Date(Date.now() + DAY) })
    expect(task?.calendarEventId).not.toBeNull()

    const events: unknown[] = []
    const off = onProspectEvent('task.done', (p) => events.push(p))
    const result = await crm.completeTask(a, task!.id, {
      outcome: 'wrong_number',
      contactPointId: point!.id,
      nextTask: { kind: 'email', title: 'Try email', dueAt: new Date(Date.now() + 2 * DAY) },
    })
    await new Promise((r) => setTimeout(r, 20))
    off()

    expect(result?.task.outcome).toBe('wrong_number')
    expect(result?.task.doneAt).not.toBeNull()
    expect(result?.nextTask?.title).toBe('Try email')
    expect(result?.nextTask?.calendarEventId).toBeNull()
    const [cp] = await db.select({ status: prospectContactPoints.status }).from(prospectContactPoints).where(eq(prospectContactPoints.id, point!.id))
    expect(cp?.status).toBe('invalid')
    const [p] = await db.select({ lastContactedAt: prospects.lastContactedAt }).from(prospects).where(eq(prospects.id, mine))
    expect(p?.lastContactedAt).not.toBeNull()
    expect(events).toEqual([{ taskId: task!.id, prospectId: mine, kind: 'call', outcome: 'wrong_number' }])
  })

  it('a colleague who cannot edit the prospect cannot close its task', async () => {
    const task = await crm.createProspectTask(b, theirs, { kind: 'task', title: 'b only', dueAt: new Date() })
    expect(await crm.completeTask(a, task!.id, {})).toBeUndefined()
  })

  it('assigning to a colleague needs repartizare or owning the prospect', async () => {
    await expect(crm.createProspectTask(b, theirs, { kind: 'task', title: 'x', dueAt: new Date(), assigneeUserId: a.id })).resolves.toBeDefined()
    await expect(crm.createProspectTask(a, mine, { kind: 'task', title: 'x', dueAt: new Date(), assigneeUserId: b.id })).resolves.toBeDefined()
  })

  it('counts overdue and today, and team scope needs repartizare', async () => {
    const user = await createTestUser('crm-counts', userIds, { features: [...AGENT, 'clienti.toti'] })
    const [p] = await db.insert(prospects).values({ name: 'QA CRM Counts SRL', assignedUserId: user.id }).returning()
    prospectIds.push(p!.id)
    const mk = (kind: 'call' | 'email' | 'linkedin_message', dueAt: Date) =>
      crm.createProspectTask(user, p!.id, { kind, title: kind, dueAt, addToCalendar: false })
    await mk('call', new Date(Date.now() - 3 * DAY))
    await mk('email', new Date())
    await mk('linkedin_message', new Date(Date.now() + 3 * DAY))

    expect(await crm.taskCounts(user, 'mine')).toEqual({ all: 3, call: 1, email: 1, linkedin: 1, today: 1, overdue: 1 })
    expect((await crm.listTasks(user, { tab: 'overdue' })).rows.map((r) => r.kind)).toEqual(['call'])
    expect((await crm.listTasks(user, { tab: 'linkedin' })).total).toBe(1)

    // `user` sees prospects of everyone, but without repartizare `team` is still only their own.
    const asTeam = await crm.listTasks(user, { scope: 'team', pageSize: 100 })
    expect(asTeam.rows.every((r) => r.assigneeUserId === user.id)).toBe(true)
    const managerTeam = await crm.listTasks(manager, { scope: 'team', pageSize: 100 })
    expect(managerTeam.rows.filter((r) => r.prospectId === p!.id)).toHaveLength(3)
    expect((await crm.listTasks(manager, { scope: 'mine', pageSize: 100 })).rows.filter((r) => r.prospectId === p!.id)).toHaveLength(0)
  })
})

describe('snippets', () => {
  it('a shared snippet is visible to a colleague who cannot edit it', async () => {
    const shared = await snippets.createSnippet(a, { name: 'Intro', body: 'Hello', shared: true })
    const mineOnly = await snippets.createSnippet(a, { name: 'Private', body: 'Secret' })
    const seen = (await snippets.listSnippets(b)).map((s) => s.id)
    expect(seen).toContain(shared!.id)
    expect(seen).not.toContain(mineOnly!.id)
    expect(await snippets.updateSnippet(b, shared!.id, { body: 'x' })).toBeUndefined()
    expect(await snippets.deleteSnippet(b, shared!.id)).toBeUndefined()
    expect((await snippets.updateSnippet(a, shared!.id, { body: 'Hi' }))?.body).toBe('Hi')
  })
})
