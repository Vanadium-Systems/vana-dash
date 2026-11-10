/**
 * Integration test on a real Postgres (test/setup.ts). Visibility and edit rights on every prospect
 * read and write, with two agents: A without `clienti.toti`, B with it, and a manager with
 * `clienti.repartizare`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import {
  billingClients,
  prospectCollaborators,
  prospectContactPoints,
  prospects,
  prospectStageEvents,
  prospectStatuses,
} from '../../shared/db/schema/index.js'
import { ProspectNotYoursError } from '../../shared/lib/prospect-access.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import type { ProspectFilter } from './filters.js'
import * as crm from './crm-service.js'
import * as service from './service.js'
import { cardsForTest } from './refs.js'

const userIds: string[] = []
const prospectIds: string[] = []
const billingClientIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']

let a: SessionUser
let b: SessionUser
let manager: SessionUser
let mine: string
let theirs: string
let free: string
let lostKey: string

const listIds = async (me: SessionUser, f: ProspectFilter[] = [], q?: string) =>
  (await service.listProspects(me, { f, q, pageSize: 100 })).rows.map((r) => (r as { id: string }).id)

beforeAll(async () => {
  a = await createTestUser('agent-a', userIds, { features: AGENT })
  b = await createTestUser('agent-b', userIds, { features: [...AGENT, 'clienti.toti'] })
  manager = await createTestUser('manager', userIds, { features: [...AGENT, 'clienti.toti', 'clienti.repartizare', 'facturi.clienti'] })

  mine = (await service.createProspect(a, { name: 'QA Mine SRL', cif: 'RO99000001', phone: '0722 000 001', email: 'Office@Mine.example', contactName: 'Ion' })).id
  theirs = (await service.createProspect(b, { name: 'QA Theirs SRL', cif: '99000002' })).id
  const [row] = await db.insert(prospects).values({ name: 'QA Free_Percent SRL' }).returning()
  free = row!.id
  prospectIds.push(mine, theirs, free)

  const [lost] = await db.select({ key: prospectStatuses.key }).from(prospectStatuses).where(and(eq(prospectStatuses.kind, 'lost'), isNull(prospectStatuses.deletedAt))).limit(1)
  if (lost) lostKey = lost.key
  else {
    lostKey = 'qa_lost'
    await db.insert(prospectStatuses).values({ key: lostKey, label: 'QA lost', colorToken: 'red', kind: 'lost' })
  }
})

afterAll(async () => {
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  if (billingClientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, billingClientIds))
  await db.delete(prospectStatuses).where(eq(prospectStatuses.key, 'qa_lost'))
  await cleanupTestUsers(userIds)
})

describe('visibility', () => {
  it('agent without clienti.toti sees own and free prospects, not a colleague’s', async () => {
    const ids = await listIds(a)
    expect(ids).toContain(mine)
    expect(ids).toContain(free)
    expect(ids).not.toContain(theirs)
  })

  it('clienti.toti sees everyone’s', async () => {
    expect(await listIds(b)).toEqual(expect.arrayContaining([mine, theirs, free]))
  })

  it('every read route answers "not found" for a hidden prospect', async () => {
    expect(await service.getProspectSheet(a, theirs)).toBeUndefined()
    expect(await service.prospectTimeline(a, theirs)).toBeUndefined()
    expect(await service.prospectNeighbors(a, theirs, { f: [] })).toBeNull()
    expect((await cardsForTest([theirs], a)).has(theirs)).toBe(false)
    expect((await cardsForTest([theirs], b)).has(theirs)).toBe(true)
  })

  it('a filter on another owner cannot get around visibility', async () => {
    expect(await listIds(a, [{ field: 'owner', op: 'in', value: [b.id] }])).toEqual([])
    expect(await service.countProspects(a, { f: [{ field: 'owner', op: 'in', value: [b.id] }] })).toBe(0)
  })

  it('the count equals the list total on the same filters', async () => {
    const f: ProspectFilter[] = [{ field: 'owner', op: 'in', value: ['me', 'free'] }]
    const list = await service.listProspects(a, { f })
    expect(await service.countProspects(a, { f })).toBe(list.total)
  })

  it('a collaborator sees the prospect; a view collaborator still cannot edit it', async () => {
    await db.insert(prospectCollaborators).values({ prospectId: theirs, userId: a.id, level: 'view' })
    expect(await listIds(a)).toContain(theirs)
    await expect(service.updateProspect(a, theirs, { name: 'x' })).rejects.toBeInstanceOf(ProspectNotYoursError)
    await db.update(prospectCollaborators).set({ level: 'edit' }).where(and(eq(prospectCollaborators.prospectId, theirs), eq(prospectCollaborators.userId, a.id)))
    expect(await service.updateProspect(a, theirs, { website: 'https://theirs.example' })).toBeTruthy()
    await db.delete(prospectCollaborators).where(eq(prospectCollaborators.prospectId, theirs))
  })
})

describe('edit rights', () => {
  it('a hidden prospect answers null (404), not 403', async () => {
    expect(await service.updateProspect(a, theirs, { name: 'x' })).toBeNull()
    expect(await service.deleteProspect(a, theirs)).toBeUndefined()
  })

  it('a free prospect is edited only after claiming it', async () => {
    await expect(service.updateProspect(a, free, { name: 'x' })).rejects.toBeInstanceOf(ProspectNotYoursError)
  })

  it('seeing everything is not editing everything: 403 with the owner’s name', async () => {
    const err = await service.updateProspect(b, mine, { name: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProspectNotYoursError)
    expect((err as ProspectNotYoursError).ownerName).toBe('QA agent-a')
  })

  it('clienti.repartizare edits anyone’s', async () => {
    expect(await service.updateProspect(manager, mine, { caenCode: '3811' })).toBeTruthy()
  })

  it('bulk status skips what the person cannot edit and reports it', async () => {
    const [open] = await db.select({ key: prospectStatuses.key }).from(prospectStatuses).where(and(eq(prospectStatuses.kind, 'open'), isNull(prospectStatuses.deletedAt))).limit(1)
    const result = await service.bulkUpdate(b, { ids: [mine, theirs], action: 'status', value: open!.key })
    expect(result.skipped.map((s) => s.id)).toEqual([mine])
  })
})

describe('data', () => {
  it('contacts go to people and contact points, normalized', async () => {
    const points = await db.select().from(prospectContactPoints).where(eq(prospectContactPoints.prospectId, mine))
    expect(points.map((p) => p.valueNormalized).sort()).toEqual(['+40722000001', 'office@mine.example'])
  })

  it('a CIF with or without RO is the same prospect', async () => {
    const err = await service.createProspect(b, { name: 'QA Dup', cif: '99000001' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(service.ProspectExistsError)
    expect((err as service.ProspectExistsError).existing.ownerName).toBe('QA agent-a')
  })

  it('a lost stage needs a reason, and the change is written to the stage history', async () => {
    await expect(service.updateProspect(a, mine, { status: lostKey })).rejects.toBeInstanceOf(service.LostReasonRequiredError)
    const sheet = await service.updateProspect(a, mine, { status: lostKey, lostReason: 'Price' })
    expect(sheet?.lostReason).toBe('Price')
    const events = await db.select().from(prospectStageEvents).where(eq(prospectStageEvents.prospectId, mine))
    expect(events.some((e) => e.toStatus === lostKey)).toBe(true)
  })

  it('search escapes LIKE wildcards', async () => {
    expect(await listIds(b, [], '_')).toEqual(expect.arrayContaining([free]))
    expect(await listIds(b, [], 'QA_Mine')).not.toContain(mine)
  })

  it('people kind lists the people with their company', async () => {
    const page = await service.listProspects(a, { f: [], kind: 'people', q: 'Mine' })
    expect(page.rows.some((r) => (r as { prospectId: string }).prospectId === mine)).toBe(true)
  })

  it('next-task filter: a prospect without tasks is "none"', async () => {
    expect(await listIds(a, [{ field: 'nextTask', op: 'in', value: ['none'] }])).toContain(mine)
  })
})

describe('correlated columns', () => {
  let full: string
  let bare: string

  type Row = { id: string; primaryPhone: string | null; primaryEmail: string | null; primaryPerson: string | null; note: { body: string } | null; nextTask: unknown; canEdit: boolean }
  const rowsOf = async (me: SessionUser, f: ProspectFilter[] = []) => (await service.listProspects(me, { f, pageSize: 100 })).rows as Row[]

  beforeAll(async () => {
    full = (await service.createProspect(a, { name: 'QA Full SRL', cif: '99000011', phone: '0733 111 222', email: 'full@full.example', contactName: 'Maria Zorila' })).id
    bare = (await service.createProspect(a, { name: 'QA Bare SRL', cif: '99000012' })).id
    prospectIds.push(full, bare)
    await crm.createNote(a, full, { body: 'qa note body' })
    await crm.createProspectTask(a, full, { kind: 'call', title: 'qa task', dueAt: new Date(Date.now() + 3 * 86400_000) })
  })

  it('the list computes phone, email, person, note and next task per row', async () => {
    const rows = await rowsOf(a)
    const f = rows.find((r) => r.id === full)!
    const bareRow = rows.find((r) => r.id === bare)!
    expect(f.primaryPhone).toBe('0733 111 222')
    expect(f.primaryEmail).toBe('full@full.example')
    expect(f.primaryPerson).toBe('Maria Zorila')
    expect(f.note?.body).toBe('qa note body')
    expect(f.nextTask).toBeTruthy()
    for (const key of ['primaryPhone', 'primaryEmail', 'primaryPerson', 'note', 'nextTask'] as const) expect(bareRow[key]).toBeNull()
  })

  it('canEdit is true for the owner and false for someone else with everything', async () => {
    const asOwner = (await rowsOf(a)).find((r) => r.id === full)!
    const asOther = (await rowsOf(b)).find((r) => r.id === full)!
    expect(asOwner.canEdit).toBe(true)
    expect(asOther.canEdit).toBe(false)
  })

  it('next-task filter splits the prospects with and without an open task', async () => {
    const none = await listIds(a, [{ field: 'nextTask', op: 'in', value: ['none'] }])
    expect(none).toContain(bare)
    expect(none).not.toContain(full)
    const future = await listIds(a, [{ field: 'nextTask', op: 'in', value: ['future'] }])
    expect(future).toContain(full)
    expect(future).not.toContain(bare)
  })

  it('phone not_empty keeps only the prospect with a phone', async () => {
    const ids = await listIds(a, [{ field: 'phone', op: 'not_empty' }])
    expect(ids).toContain(full)
    expect(ids).not.toContain(bare)
  })

  it('free text finds a prospect by the name of its contact person', async () => {
    const ids = await listIds(a, [], 'zorila')
    expect(ids).toContain(full)
    expect(ids).not.toContain(bare)
  })

  it('a collaborator makes a foreign prospect visible, and removing them hides it again', async () => {
    const other = (await service.createProspect(b, { name: 'QA Other SRL', cif: '99000013' })).id
    prospectIds.push(other)
    expect(await listIds(a)).not.toContain(other)
    await db.insert(prospectCollaborators).values({ prospectId: other, userId: a.id, level: 'view' })
    expect(await listIds(a)).toContain(other)
    await db.delete(prospectCollaborators).where(eq(prospectCollaborators.prospectId, other))
    expect(await listIds(a)).not.toContain(other)
  })
})

const offer = {
  subscriptionPriceEur: 150,
  contractPlan: 'Standard',
  details: { operatoriGestiune: 3, puncteLucru: 2 },
  calc: { platformId: '00000000-0000-4000-8000-000000000001', flux: 'standard' as const, opDesktop: 3, opMobil: 0, puncte: 2, documente: 0, siatd: 0 },
}

describe('offer', () => {
  it('is saved by an editor, read in the sheet, and refused to anyone else', async () => {
    await expect(service.saveOffer(b, mine, offer)).rejects.toBeInstanceOf(ProspectNotYoursError)
    await service.saveOffer(a, mine, offer)
    const sheet = (await service.getProspectSheet(a, mine)) as { offer: { subscriptionPriceEur: number; savedAt: string } | null }
    expect(sheet.offer?.subscriptionPriceEur).toBe(150)
    expect(sheet.offer?.savedAt).toBeTruthy()
    await service.saveOffer(a, mine, null)
    expect(((await service.getProspectSheet(a, mine)) as { offer: unknown }).offer).toBeNull()
  })

  it('lands on the client at promotion; without one the client has no price', async () => {
    await service.saveOffer(a, mine, offer)
    const withOffer = await service.promoteProspect(manager, mine, { address: 'Str. 1' })
    billingClientIds.push(withOffer!.billingClientId!)
    const [client] = await db.select().from(billingClients).where(eq(billingClients.id, withOffer!.billingClientId!))
    expect(client!.subscriptionPriceEur).toBe('150.00')
    expect(client!.contractPlan).toBe('Standard')
    expect(client!.contractDetails).toMatchObject({ operatoriGestiune: '3', puncteLucru: '2', calc: offer.calc })

    await db.update(prospects).set({ billingClientId: null, offer: null }).where(eq(prospects.id, mine))
    const without = await service.promoteProspect(manager, mine, { address: 'Str. 1' })
    billingClientIds.push(without!.billingClientId!)
    const [plain] = await db.select().from(billingClients).where(eq(billingClients.id, without!.billingClientId!))
    expect(plain!.subscriptionPriceEur).toBeNull()
    expect(plain!.contractPlan).toBeNull()
    await db.update(prospects).set({ billingClientId: null }).where(eq(prospects.id, mine))
  })
})

describe('promote', () => {
  it('needs edit rights and links the client in one go', async () => {
    await expect(service.promoteProspect(b, mine, { address: 'Str. 1' })).rejects.toBeInstanceOf(ProspectNotYoursError)
    const row = await service.promoteProspect(manager, mine, { address: 'Str. 1' })
    expect(row?.billingClientId).toBeTruthy()
    billingClientIds.push(row!.billingClientId!)
    await db.update(prospects).set({ billingClientId: null }).where(eq(prospects.id, mine))
  })
})
