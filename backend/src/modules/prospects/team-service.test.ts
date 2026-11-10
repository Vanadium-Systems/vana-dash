/**
 * Integration test on a real Postgres (test/setup.ts): claiming, transfers, requests, mentions,
 * automatic release and what happens to a person's prospects when they are disabled.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, dashboardConfig, notifications, prospectCollaborators, prospectNotes, prospects, prospectTasks, prospectStatuses, prospectTransferRequests, roles } from '../../shared/db/schema/index.js'
import { ProspectNotYoursError } from '../../shared/lib/prospect-access.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { updateMember } from '../team/service.js'
import { createNote } from './crm-service.js'
import { runProspectRelease } from './release-service.js'
import * as team from './team-service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']

let ana: SessionUser
let bob: SessionUser
let manager: SessionUser
let admin: SessionUser

const newProspect = async (name: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `QA ${name}`, ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}
const bellOf = (userId: string, kind?: string) =>
  db
    .select()
    .from(notifications)
    .where(kind ? and(eq(notifications.userId, userId), eq(notifications.kind, kind)) : eq(notifications.userId, userId))
const ownerOf = async (id: string) => (await db.select().from(prospects).where(eq(prospects.id, id)))[0]!
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)

beforeAll(async () => {
  ana = await createTestUser('ana', userIds, { features: AGENT })
  bob = await createTestUser('bob', userIds, { features: AGENT })
  manager = await createTestUser('manager', userIds, { features: [...AGENT, 'clienti.toti', 'clienti.repartizare'] })
  admin = await createTestUser('admin', userIds, { roleKind: 'admin', features: [...AGENT, 'clienti.toti', 'clienti.repartizare'] })
})

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, 'clienti.release'))
  if (prospectIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
    await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  }
  await cleanupTestUsers(userIds)
})

describe('claim', () => {
  it('claims a free prospect', async () => {
    const id = await newProspect('claim-free')
    await team.claimProspect(ana, id)
    const row = await ownerOf(id)
    expect(row.assignedUserId).toBe(ana.id)
    expect(row.claimedAt).toBeTruthy()
    expect(row.lastActivityAt).toBeTruthy()
  })

  it('refuses a prospect somebody already has', async () => {
    const id = await newProspect('claim-taken', { assignedUserId: bob.id })
    await db.insert(prospectCollaborators).values({ prospectId: id, userId: ana.id, level: 'view' })
    await expect(team.claimProspect(ana, id)).rejects.toMatchObject({ code: 'PROSPECT_TAKEN', ownerName: 'QA bob' })
  })

  it('a hidden prospect that somebody has is also "taken"; a missing one is not found', async () => {
    const id = await newProspect('claim-hidden', { assignedUserId: bob.id })
    await expect(team.claimProspect(ana, id)).rejects.toMatchObject({ code: 'PROSPECT_TAKEN' })
    expect(await team.claimProspect(ana, crypto.randomUUID())).toBeUndefined()
  })

  it('two people pressing at once: exactly one wins', async () => {
    const id = await newProspect('claim-race')
    const results = await Promise.allSettled([team.claimProspect(ana, id), team.claimProspect(bob, id)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toMatchObject({ code: 'PROSPECT_TAKEN' })
  })

  it('release: the owner or a manager only', async () => {
    const id = await newProspect('release', { assignedUserId: ana.id, claimedAt: new Date() })
    await db.insert(prospectCollaborators).values({ prospectId: id, userId: bob.id, level: 'view' })
    await expect(team.releaseProspect(bob, id)).rejects.toBeInstanceOf(ProspectNotYoursError)
    await team.releaseProspect(ana, id)
    expect((await ownerOf(id)).assignedUserId).toBeNull()
  })
})

describe('transfer', () => {
  it('skips what is not yours without repartizare', async () => {
    const mine = await newProspect('t-mine', { assignedUserId: ana.id })
    const theirs = await newProspect('t-theirs', { assignedUserId: bob.id })
    await db.insert(prospectCollaborators).values({ prospectId: theirs, userId: ana.id, level: 'edit' })
    const res = await team.transferProspects(ana, { ids: [mine, theirs], toUserId: manager.id })
    expect(res.transferred).toBe(1)
    expect(res.skipped).toEqual([{ id: theirs, reason: 'notYours' }])
    expect((await ownerOf(theirs)).assignedUserId).toBe(bob.id)
  })

  it('a bulk transfer sends one notification and leaves a handover note', async () => {
    const ids = await Promise.all([newProspect('bulk-1', { assignedUserId: ana.id }), newProspect('bulk-2', { assignedUserId: ana.id }), newProspect('bulk-3', { assignedUserId: ana.id })])
    const before = (await bellOf(bob.id, 'clienti.transfer')).length
    const res = await team.transferProspects(ana, { ids, toUserId: bob.id, note: 'call on Monday' })
    expect(res.transferred).toBe(3)
    const bell = await bellOf(bob.id, 'clienti.transfer')
    expect(bell).toHaveLength(before + 1)
    expect(bell.at(-1)?.title).toContain('3')
    const notes = await db.select().from(prospectNotes).where(inArray(prospectNotes.prospectId, ids))
    expect(notes).toHaveLength(3)
    expect(notes[0]?.body).toBe('Predare: call on Monday')
    expect(notes[0]?.authorUserId).toBe(ana.id)
  })

  it('a manager moves anyone’s prospect', async () => {
    const id = await newProspect('t-manager', { assignedUserId: bob.id })
    expect((await team.transferProspects(manager, { ids: [id], toUserId: ana.id })).transferred).toBe(1)
    expect((await ownerOf(id)).assignedUserId).toBe(ana.id)
  })
})

describe('requests', () => {
  it('an accepted transfer request changes the owner and tells both', async () => {
    const id = await newProspect('rq-transfer', { assignedUserId: bob.id })
    await db.insert(prospectCollaborators).values({ prospectId: id, userId: ana.id, level: 'view' })
    const request = await team.createTransferRequest(ana, id, { kind: 'transfer', note: 'my client' })
    expect(request).toMatchObject({ kind: 'transfer', status: 'pending' })
    expect((await bellOf(bob.id, 'clienti.request')).some((n) => n.entityId === id)).toBe(true)

    expect(await team.listTransferRequests(bob, 'incoming')).toEqual(expect.arrayContaining([expect.objectContaining({ id: request!.id })]))
    expect(await team.listTransferRequests(ana, 'outgoing')).toEqual(expect.arrayContaining([expect.objectContaining({ id: request!.id })]))

    await team.decideTransferRequest(manager, request!.id, 'accept')
    expect((await ownerOf(id)).assignedUserId).toBe(ana.id)
    expect((await bellOf(ana.id, 'clienti.request')).some((n) => n.entityId === id && n.title.includes('acceptată'))).toBe(true)
    // The manager decided, so the previous owner is told too.
    expect((await bellOf(bob.id, 'clienti.request')).some((n) => n.entityId === id && n.title.includes('a trecut la'))).toBe(true)
  })

  it('an accepted access request makes the requester an edit collaborator', async () => {
    const id = await newProspect('rq-access', { assignedUserId: bob.id })
    const request = await team.createTransferRequest(ana, id, { kind: 'access' })
    await team.decideTransferRequest(bob, request!.id, 'accept')
    const [collab] = await db.select().from(prospectCollaborators).where(and(eq(prospectCollaborators.prospectId, id), eq(prospectCollaborators.userId, ana.id)))
    expect(collab?.level).toBe('edit')
    expect((await ownerOf(id)).assignedUserId).toBe(bob.id)
  })

  it('an access request works on a prospect the person cannot see', async () => {
    const id = await newProspect('rq-hidden', { assignedUserId: bob.id })
    expect(await team.createTransferRequest(ana, id, { kind: 'access' })).toMatchObject({ status: 'pending' })
    // A transfer request needs a visible prospect.
    expect(await team.createTransferRequest(ana, id, { kind: 'transfer' })).toBeUndefined()
  })

  it('a duplicate pending request is refused', async () => {
    const id = await newProspect('rq-dup', { assignedUserId: bob.id })
    await team.createTransferRequest(ana, id, { kind: 'access' })
    await expect(team.createTransferRequest(ana, id, { kind: 'access' })).rejects.toMatchObject({ code: 'REQUEST_EXISTS' })
  })

  it('someone who is not the owner cannot refuse; the requester can cancel; a closed request stays closed', async () => {
    const id = await newProspect('rq-refuse', { assignedUserId: bob.id })
    const other = await createTestUser('other', userIds, { features: AGENT })
    const request = await team.createTransferRequest(ana, id, { kind: 'access' })
    await expect(team.decideTransferRequest(other, request!.id, 'refuse')).rejects.toMatchObject({ code: 'REQUEST_NOT_ALLOWED' })
    await expect(team.decideTransferRequest(bob, request!.id, 'cancel')).rejects.toMatchObject({ code: 'REQUEST_NOT_ALLOWED' })
    await team.decideTransferRequest(ana, request!.id, 'cancel')
    await expect(team.decideTransferRequest(bob, request!.id, 'accept')).rejects.toMatchObject({ code: 'REQUEST_DECIDED' })
    const [row] = await db.select().from(prospectTransferRequests).where(eq(prospectTransferRequests.id, request!.id))
    expect(row?.status).toBe('cancelled')
  })
})

describe('collaborators and contact check', () => {
  it('only the owner or a manager sets collaborators, and the colleague is told', async () => {
    const id = await newProspect('collab', { assignedUserId: bob.id })
    await expect(team.setCollaborator(ana, id, ana.id, { level: 'view' })).resolves.toBeUndefined()
    await team.setCollaborator(bob, id, ana.id, { level: 'view' })
    expect((await bellOf(ana.id, 'clienti.collaborator')).some((n) => n.entityId === id)).toBe(true)
    await team.setCollaborator(bob, id, ana.id, { level: 'edit' })
    const [row] = await db.select().from(prospectCollaborators).where(eq(prospectCollaborators.prospectId, id))
    expect(row?.level).toBe('edit')
    await expect(team.removeCollaborator(ana, id, ana.id)).rejects.toBeInstanceOf(ProspectNotYoursError)
    await team.removeCollaborator(bob, id, ana.id)
    expect(await team.contactCheck(ana, id)).toBeUndefined()
  })

  it('contact check names the owner and the latest activity', async () => {
    const id = await newProspect('check', { assignedUserId: ana.id, claimedAt: daysAgo(3) })
    await db.insert(prospectNotes).values({ prospectId: id, authorUserId: ana.id, body: 'hello' })
    const check = await team.contactCheck(bob, id)
    expect(check).toBeUndefined() // Bob cannot see it
    const seen = await team.contactCheck(manager, id)
    expect(seen).toMatchObject({ ownerName: 'QA ana', lastActivityKind: 'note', lastActivityBy: 'QA ana' })
  })
})

describe('mentions', () => {
  it('notifies only the people who can open the prospect', async () => {
    const id = await newProspect('mention', { assignedUserId: ana.id })
    // The mention filter loads people from the database, so these two need real roles.
    const viewer = await createTestUser('viewer', userIds, { roleKind: 'custom' })
    await db.update(roles).set({ features: ['clienti.view'] }).where(eq(roles.id, viewer.role!.id))
    const boss = await createTestUser('boss', userIds, { roleKind: 'admin' })
    await createNote(ana, id, { body: 'look', mentions: [boss.id, viewer.id, ana.id] })
    expect((await bellOf(boss.id, 'clienti.mention')).some((n) => n.entityId === id)).toBe(true)
    expect((await bellOf(viewer.id, 'clienti.mention')).some((n) => n.entityId === id)).toBe(false)
    expect((await bellOf(ana.id, 'clienti.mention')).some((n) => n.entityId === id)).toBe(false)
    const [mention] = (await bellOf(boss.id, 'clienti.mention')).filter((n) => n.entityId === id)
    expect(mention?.url).toBe(`/clients?prospect=${id}`)
  })
})

describe('automatic release', () => {
  it('does nothing while switched off (the default)', async () => {
    const id = await newProspect('auto-off', { assignedUserId: ana.id, claimedAt: daysAgo(400), lastActivityAt: daysAgo(400) })
    expect(await runProspectRelease('ro')).toEqual({ released: 0, warned: 0 })
    expect((await ownerOf(id)).assignedUserId).toBe(ana.id)
  })

  it('releases after the limit, warns once in the window, and a new note restarts the clock', async () => {
    await team.setReleaseSettings({ enabled: true, idleDays: 30, warnDays: 5 })
    const old = await newProspect('auto-old', { assignedUserId: ana.id, claimedAt: daysAgo(90), lastActivityAt: daysAgo(31) })
    const window = await newProspect('auto-window', { assignedUserId: ana.id, claimedAt: daysAgo(90), lastActivityAt: daysAgo(27) })
    const fresh = await newProspect('auto-fresh', { assignedUserId: ana.id, claimedAt: daysAgo(90), lastActivityAt: daysAgo(2) })

    await runProspectRelease('ro')
    expect((await ownerOf(old)).assignedUserId).toBeNull()
    expect((await ownerOf(old)).claimedAt).toBeNull()
    expect((await ownerOf(window)).assignedUserId).toBe(ana.id)
    expect((await ownerOf(fresh)).assignedUserId).toBe(ana.id)
    const warnings = () => bellOf(ana.id, 'clienti.release_warning').then((rows) => rows.filter((n) => n.entityId === window))
    expect(await warnings()).toHaveLength(1)
    expect((await bellOf(ana.id, 'clienti.released')).some((n) => n.entityId === old)).toBe(true)

    await runProspectRelease('ro')
    expect(await warnings()).toHaveLength(1)

    // A note touches lastActivityAt: out of the window, and a later idle stretch warns again.
    await createNote(ana, window, { body: 'called' })
    await runProspectRelease('ro')
    expect(await warnings()).toHaveLength(1)
    await db.update(prospects).set({ lastActivityAt: daysAgo(27) }).where(eq(prospects.id, window))
    // In real life the second stretch starts after the first warning; here the clock is set back by hand.
    await db.update(notifications).set({ createdAt: daysAgo(40) }).where(eq(notifications.entityId, window))
    await runProspectRelease('ro')
    expect(await warnings()).toHaveLength(2)
  })
})

describe('automatic release and closed deals', () => {
  it('leaves won prospects alone: no release, no warning', async () => {
    await team.setReleaseSettings({ enabled: true, idleDays: 30, warnDays: 5 })
    const [won] = await db.select({ key: prospectStatuses.key }).from(prospectStatuses).where(and(eq(prospectStatuses.kind, 'won'), isNull(prospectStatuses.deletedAt))).limit(1)
    let wonKey = won?.key
    if (!wonKey) {
      wonKey = 'qa_won'
      await db.insert(prospectStatuses).values({ key: wonKey, label: 'QA won', colorToken: 'emerald', kind: 'won' })
    }
    const idle = await newProspect('won-idle', { assignedUserId: ana.id, status: wonKey, claimedAt: daysAgo(90), lastActivityAt: daysAgo(40) })
    const inWindow = await newProspect('won-window', { assignedUserId: ana.id, status: wonKey, claimedAt: daysAgo(90), lastActivityAt: daysAgo(27) })
    await runProspectRelease('ro')
    expect((await ownerOf(idle)).assignedUserId).toBe(ana.id)
    expect((await ownerOf(inWindow)).assignedUserId).toBe(ana.id)
    const warned = await bellOf(ana.id, 'clienti.release_warning')
    expect(warned.some((n) => n.entityId === inWindow)).toBe(false)
    await db.delete(prospectStatuses).where(eq(prospectStatuses.key, 'qa_won'))
  })
})

describe('a person leaves', () => {
  it('frees their prospects and passes open tasks to whoever disabled them', async () => {
    const leaver = await createTestUser('leaver', userIds, { roleKind: 'custom', features: AGENT })
    const a = await newProspect('leave-1', { assignedUserId: leaver.id, claimedAt: new Date() })
    const b = await newProspect('leave-2', { assignedUserId: leaver.id, claimedAt: new Date() })
    const task = { assigneeUserId: leaver.id, kind: 'task' as const, title: 'follow up', dueAt: new Date() }
    await db.insert(prospectTasks).values([{ ...task, prospectId: a }, { ...task, prospectId: b }, { ...task, prospectId: b, doneAt: new Date() }])

    await updateMember(admin, leaver.id, { status: 'disabled' })

    for (const id of [a, b]) {
      const row = await ownerOf(id)
      expect(row.assignedUserId).toBeNull()
      expect(row.claimedAt).toBeNull()
    }
    const tasks = await db.select().from(prospectTasks).where(inArray(prospectTasks.prospectId, [a, b]))
    expect(tasks.filter((t) => t.assigneeUserId === admin.id)).toHaveLength(2)
    expect(tasks.filter((t) => t.assigneeUserId === leaver.id)).toHaveLength(1) // the done one stays
    expect((await bellOf(admin.id, 'clienti.tasks_taken'))[0]?.title).toContain('2')
    const audits = await db.select().from(auditLog).where(and(inArray(auditLog.entityId, [a, b]), eq(auditLog.action, 'prospect.eliberat.plecare')))
    expect(audits).toHaveLength(2)
  })
})
