/**
 * Integration test on a real Postgres (test/setup.ts): the health counts, the duplicate job and
 * merging two prospects without losing anything.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import {
  auditLog,
  calls,
  dashboardConfig,
  emailSequenceEnrollments,
  emailSequences,
  prospectArchives,
  prospectCollaborators,
  prospectContactPoints,
  prospectListMembers,
  prospectLists,
  prospectNotes,
  prospectPeople,
  prospects,
  prospectStageEvents,
  prospectTasks,
} from '../../shared/db/schema/index.js'
import { ProspectNotYoursError } from '../../shared/lib/prospect-access.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import * as health from './health-service.js'
import { getProspectSheet } from './service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const listIds: string[] = []
const sequenceIds: string[] = []
const callIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']
const TAG = `QAHL${Date.now()}`

let ana: SessionUser
let bob: SessionUser
let manager: SessionUser

const newProspect = async (name: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `${TAG} ${name}`, assignedUserId: ana.id, ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}
const addPoint = (prospectId: string, kind: 'phone' | 'email', value: string, extra: Partial<typeof prospectContactPoints.$inferInsert> = {}) =>
  db.insert(prospectContactPoints).values({ prospectId, kind, value, valueNormalized: value.toLowerCase(), ...extra })
const pairOf = async (a: string, b: string) => {
  const state = await health.recomputeDuplicates()
  return state.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))
}

beforeAll(async () => {
  ana = await createTestUser('ana', userIds, { features: AGENT })
  bob = await createTestUser('bob', userIds, { features: AGENT })
  manager = await createTestUser('manager', userIds, { features: [...AGENT, 'clienti.toti', 'clienti.repartizare'] })
})

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, 'clienti.duplicates'))
  if (callIds.length) await db.delete(calls).where(inArray(calls.id, callIds))
  if (sequenceIds.length) await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds))
  if (listIds.length) await db.delete(prospectLists).where(inArray(prospectLists.id, listIds))
  if (prospectIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
    await db.update(prospects).set({ mergedIntoId: null }).where(inArray(prospects.id, prospectIds))
    await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  }
  await cleanupTestUsers(userIds)
})

describe('health counts', () => {
  it('counts what is missing, invalid and struck off, only for what the person sees', async () => {
    const before = await health.getHealth(ana)
    const complete = await newProspect('complete')
    await addPoint(complete, 'phone', '+40711000001')
    await addPoint(complete, 'email', 'ok@complete.example')
    await newProspect('empty')
    const badPhone = await newProspect('bad-phone', { isActive: false })
    await addPoint(badPhone, 'phone', '+40711000002', { status: 'invalid' })
    await addPoint(badPhone, 'email', 'bounced@bad.example', { status: 'bounced' })
    const archived = await newProspect('archived')
    await db.insert(prospectArchives).values({ prospectId: archived, userId: ana.id })
    await newProspect('theirs', { assignedUserId: bob.id })
    await db.update(prospects).set({ deletedAt: new Date() }).where(eq(prospects.id, await newProspect('deleted')))

    const after = await health.getHealth(ana)
    // empty + badPhone; complete has both. The archived, deleted and bob's are not counted for ana.
    expect(after.withoutPhone - before.withoutPhone).toBe(2)
    expect(after.withoutEmail - before.withoutEmail).toBe(2)
    expect(after.invalidOrBounced - before.invalidOrBounced).toBe(1)
    expect(after.struckOff - before.struckOff).toBe(1)
  })
})

describe('duplicate job', () => {
  it('finds the CIF pair with and without RO, a phone pair and a name pair', async () => {
    const digits = String(Math.floor(Math.random() * 9_000_000) + 1_000_000)
    const a = await newProspect('cif-a', { cif: `RO${digits}` })
    const b = await newProspect('cif-b', { cif: ` ${digits}` })
    expect((await pairOf(a, b))?.reasons).toContain('cif')

    const p1 = await newProspect('phone-a')
    const p2 = await newProspect('phone-b')
    await addPoint(p1, 'phone', `+4072${digits}`)
    await addPoint(p2, 'phone', `+4072${digits}`)
    expect((await pairOf(p1, p2))?.reasons).toEqual(['phone'])

    const n1 = await db.insert(prospects).values({ name: `Acme ${TAG}x SRL`, assignedUserId: ana.id }).returning()
    const n2 = await db.insert(prospects).values({ name: `ACME ${TAG}X S.R.L.`, assignedUserId: ana.id }).returning()
    prospectIds.push(n1[0]!.id, n2[0]!.id)
    expect((await pairOf(n1[0]!.id, n2[0]!.id))?.reasons).toEqual(['name'])
  })

  it('keeps the "sa" of "casa" and ignores deleted prospects', async () => {
    const a = await newProspect('Casa Verde')
    const b = await newProspect('Cas Verde')
    expect(await pairOf(a, b)).toBeUndefined()
    const twin = await newProspect('Casa Verde', { deletedAt: new Date() })
    expect(await pairOf(a, twin)).toBeUndefined()
    await db.update(prospects).set({ deletedAt: null }).where(eq(prospects.id, twin))
    expect((await pairOf(a, twin))?.reasons).toEqual(['name'])
  })

  it('a pair with an invisible side is hidden from an agent without clienti.toti', async () => {
    const mine = await newProspect('vis-mine', { name: `${TAG} Visible Twin` })
    const theirs = await newProspect('vis-theirs', { name: `${TAG} Visible Twin`, assignedUserId: bob.id })
    expect(await pairOf(mine, theirs)).toBeDefined()
    const forAna = await health.listDuplicates(ana, 1, 100)
    expect(forAna.items.some((i) => [i.a.id, i.b.id].includes(theirs))).toBe(false)
    const forManager = await health.listDuplicates(manager, 1, 100)
    const item = forManager.items.find((i) => [i.a.id, i.b.id].includes(theirs))
    expect(item?.canMerge).toBe(true)
    expect((await health.getHealth(manager)).duplicates).toBeGreaterThan((await health.getHealth(ana)).duplicates)
  })
})

describe('merge', () => {
  async function seedPair() {
    const master = await newProspect('m', { website: 'https://master.example', revenue: '1000', revenuePrev: '900', revenueYear: 2023, updatedAt: new Date(Date.now() - 86_400_000) })
    const other = await newProspect('o', { website: null, revenue: '5000', revenuePrev: '4000', revenueYear: 2024, cif: `RO${Math.floor(Math.random() * 9_000_000) + 1_000_000}` })
    const [person] = await db.insert(prospectPeople).values({ prospectId: other, name: 'Ion' }).returning()
    await db.insert(prospectPeople).values({ prospectId: master, name: 'Maria' })
    await addPoint(master, 'phone', '+40733000001', { isPrimary: true })
    await addPoint(other, 'phone', '+40733000001', { isPrimary: true })
    await addPoint(other, 'email', 'other@merge.example', { personId: person!.id })
    await db.insert(prospectNotes).values({ prospectId: other, body: 'n1' })
    await db.insert(prospectNotes).values({ prospectId: master, body: 'n2' })
    await db.insert(prospectTasks).values({ prospectId: other, assigneeUserId: ana.id, kind: 'call', title: 't', dueAt: new Date() })
    const [list] = await db.insert(prospectLists).values({ ownerUserId: ana.id, name: `${TAG} list` }).returning()
    const [list2] = await db.insert(prospectLists).values({ ownerUserId: ana.id, name: `${TAG} list2` }).returning()
    listIds.push(list!.id, list2!.id)
    await db.insert(prospectListMembers).values([
      { listId: list!.id, prospectId: master },
      { listId: list!.id, prospectId: other },
      { listId: list2!.id, prospectId: other },
    ])
    await db.insert(prospectStageEvents).values({ prospectId: other, toStatus: 'contactat', changedAt: new Date() })
    const [seq] = await db.insert(emailSequences).values({ name: `${TAG} seq`, fromIdentity: 'x@test.local' }).returning()
    sequenceIds.push(seq!.id)
    await db.insert(emailSequenceEnrollments).values([
      { sequenceId: seq!.id, prospectId: master, recipientEmail: `m-${TAG}@merge.example` },
      { sequenceId: seq!.id, prospectId: other, recipientEmail: `o-${TAG}@merge.example` },
    ])
    await db.insert(prospectCollaborators).values([
      { prospectId: master, userId: bob.id, level: 'view' },
      { prospectId: other, userId: bob.id, level: 'edit' },
      { prospectId: other, userId: manager.id, level: 'view' },
    ])
    await db.insert(prospectArchives).values([
      { prospectId: master, userId: bob.id },
      { prospectId: other, userId: bob.id },
      { prospectId: other, userId: manager.id },
    ])
    const [call] = await db
      .insert(calls)
      .values({ title: 'c', roomName: `r-${crypto.randomUUID()}`, roomUrl: 'https://x.example', publicId: crypto.randomUUID(), expiresAt: new Date(), prospectId: other })
      .returning()
    callIds.push(call!.id)
    return { master, other }
  }

  it('previews the differing fields with a proposal and the counts to move', async () => {
    const { master, other } = await seedPair()
    const preview = await health.previewMerge(ana, master, other)
    const field = (name: string) => preview!.fields.find((f) => f.field === name)
    expect(field('website')).toMatchObject({ proposed: 'master' })
    expect(field('cif')).toMatchObject({ proposed: 'other' })
    expect(field('revenue')).toMatchObject({ proposed: 'other' })
    expect(preview!.moves).toMatchObject({ people: 1, contactPoints: 2, notes: 1, tasks: 1, listMemberships: 2, enrollments: 1, stageEvents: 1, collaborators: 2, calls: 1 })
    await expect(health.previewMerge(ana, master, master)).rejects.toBeInstanceOf(health.MergeSameError)
  })

  it('moves everything to the master and loses nothing', async () => {
    const { master, other } = await seedPair()
    const sheet = await health.mergeProspects(ana, master, other, { revenue: 'other', cif: 'other' })
    expect(sheet!.id).toBe(master)

    expect(sheet!.people.map((p) => p.name).sort()).toEqual(['Ion', 'Maria'])
    // The shared phone is not doubled and the master's stays primary; the email arrives.
    const points = sheet!.contactPoints
    expect(points.filter((p) => p.kind === 'phone')).toHaveLength(1)
    expect(points.filter((p) => p.kind === 'email')).toHaveLength(1)
    expect(points.find((p) => p.kind === 'phone')!.isPrimary).toBe(true)

    expect(await db.select().from(prospectNotes).where(and(eq(prospectNotes.prospectId, master), isNull(prospectNotes.deletedAt)))).toHaveLength(2)
    expect(await db.select().from(prospectTasks).where(eq(prospectTasks.prospectId, master))).toHaveLength(1)
    const members = await db.select().from(prospectListMembers).where(inArray(prospectListMembers.listId, listIds))
    expect(members.filter((m) => m.prospectId === master)).toHaveLength(2)
    expect(members.filter((m) => m.prospectId === other)).toHaveLength(0)
    expect(await db.select().from(prospectStageEvents).where(eq(prospectStageEvents.prospectId, master))).toHaveLength(1)
    const enrollments = await db.select().from(emailSequenceEnrollments).where(inArray(emailSequenceEnrollments.sequenceId, sequenceIds))
    // Same sequence on both: the other's enrollment stays behind and stops, so the company is mailed once.
    expect(enrollments.find((e) => e.prospectId === master)!.status).toBe('active')
    expect(enrollments.find((e) => e.prospectId === other)!.status).toBe('completed')
    const collaborators = await db.select().from(prospectCollaborators).where(and(eq(prospectCollaborators.prospectId, master), isNull(prospectCollaborators.deletedAt)))
    expect(collaborators.map((c) => `${c.userId}:${c.level}`).sort()).toEqual([`${bob.id}:edit`, `${manager.id}:view`].sort())
    const archives = await db.select().from(prospectArchives).where(eq(prospectArchives.prospectId, master))
    expect(archives.map((a) => a.userId).sort()).toEqual([bob.id, manager.id].sort())
    expect(await db.select().from(calls).where(eq(calls.prospectId, master))).toHaveLength(1)

    // The chosen fields moved; the rest stayed.
    const [row] = await db.select().from(prospects).where(eq(prospects.id, master))
    expect(row).toMatchObject({ revenue: '5000.00', revenuePrev: '4000.00', revenueYear: 2024, website: 'https://master.example' })
    expect(row!.cif).toMatch(/^RO/)
    const [old] = await db.select().from(prospects).where(eq(prospects.id, other))
    expect(old).toMatchObject({ mergedIntoId: master, cif: null })
    expect(old!.deletedAt).not.toBeNull()

    // The old link opens the master.
    expect((await getProspectSheet(ana, other))!.id).toBe(master)
    // Audit on both.
    const audits = await db.select().from(auditLog).where(inArray(auditLog.entityId, [master, other]))
    expect(audits.map((a) => a.action).sort()).toEqual(['prospect.unit', 'prospect.unit.in'])
    expect(audits.find((a) => a.action === 'prospect.unit')!.changes).toMatchObject({ mergedFrom: [null, other] })
    // A second merge of the same one is refused.
    await expect(health.mergeProspects(ana, master, other, {})).rejects.toBeInstanceOf(health.MergeAlreadyMergedError)
  })

  it('refuses when the person can edit only one side, and changes nothing', async () => {
    const mine = await newProspect('edit-mine')
    const theirs = await newProspect('edit-theirs', { assignedUserId: bob.id })
    await db.insert(prospectCollaborators).values({ prospectId: theirs, userId: ana.id, level: 'view' })
    await db.insert(prospectNotes).values({ prospectId: theirs, body: 'stays' })
    await expect(health.mergeProspects(ana, mine, theirs, {})).rejects.toBeInstanceOf(ProspectNotYoursError)
    await expect(health.mergeProspects(ana, theirs, mine, {})).rejects.toBeInstanceOf(ProspectNotYoursError)
    expect(await db.select().from(prospectNotes).where(eq(prospectNotes.prospectId, theirs))).toHaveLength(1)
    const [row] = await db.select().from(prospects).where(eq(prospects.id, theirs))
    expect(row!.deletedAt).toBeNull()
  })

  it('an invisible prospect answers as not found', async () => {
    const mine = await newProspect('inv-mine')
    const theirs = await newProspect('inv-theirs', { assignedUserId: bob.id })
    expect(await health.mergeProspects(ana, mine, theirs, {})).toBeUndefined()
  })

  it('takes the status of the other when chosen, with a stage event', async () => {
    const master = await newProspect('st-m')
    const other = await newProspect('st-o', { status: 'contactat' })
    await health.mergeProspects(ana, master, other, { status: 'other' })
    const [row] = await db.select().from(prospects).where(eq(prospects.id, master))
    expect(row!.status).toBe('contactat')
    const events = await db.select().from(prospectStageEvents).where(and(eq(prospectStageEvents.prospectId, master), eq(prospectStageEvents.toStatus, 'contactat')))
    expect(events.length).toBeGreaterThan(0)
  })
})
