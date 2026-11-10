/** Integration test on a real Postgres: list folders, static lists, adding from a search and what a person sees of a list. */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { prospectContactPoints, prospectListFolders, prospectListMembers, prospectLists, prospectPeople, prospects } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import * as lists from './lists-service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const listIds: string[] = []
const folderIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']

let ana: SessionUser
let bob: SessionUser
let manager: SessionUser

const newProspect = async (tag: string, label: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `QA list ${label}`, source: tag, assignedUserId: ana.id, ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}
const addPhone = (prospectId: string, status: 'ok' | 'invalid' = 'ok') =>
  db.insert(prospectContactPoints).values({ prospectId, kind: 'phone', value: '0722000000', valueNormalized: '+40722000000', status })
const addPerson = (prospectId: string, doNotContact: boolean) => db.insert(prospectPeople).values({ prospectId, name: 'QA person', doNotContact })
const newList = async (me: SessionUser, name: string, extra: { folderId?: string; shared?: boolean } = {}) => {
  const list = await lists.createList(me, { name: `QA ${name}`, shared: false, ...extra })
  listIds.push(list.id)
  return list.id
}
const search = (tag: string) => ({ f: [{ field: 'source' as const, op: 'in' as const, value: [tag] }] })
const membersOf = async (listId: string) => (await db.select().from(prospectListMembers).where(eq(prospectListMembers.listId, listId))).length

beforeAll(async () => {
  ana = await createTestUser('ana', userIds, { features: AGENT })
  bob = await createTestUser('bob', userIds, { features: AGENT })
  manager = await createTestUser('manager', userIds, { features: [...AGENT, 'clienti.toti'] })
})

afterAll(async () => {
  if (listIds.length) await db.delete(prospectLists).where(inArray(prospectLists.id, listIds))
  if (folderIds.length) await db.delete(prospectListFolders).where(inArray(prospectListFolders.id, folderIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await cleanupTestUsers(userIds)
})

describe('lists', () => {
  it('memberCount counts only the prospects I can see', async () => {
    const tag = `qa-count-${crypto.randomUUID()}`
    const mine = await newProspect(tag, 'mine')
    const hers = await newProspect(tag, 'bobs', { assignedUserId: bob.id })
    const gone = await newProspect(tag, 'deleted', { deletedAt: new Date() })
    const listId = await newList(ana, 'count', { shared: true })
    await db.insert(prospectListMembers).values([mine, hers, gone].map((prospectId) => ({ listId, prospectId })))
    const countFor = async (me: SessionUser) => (await lists.listLists(me)).find((l) => l.id === listId)?.memberCount
    expect(await countFor(ana)).toBe(1)
    expect(await countFor(manager)).toBe(2)
  })

  it('a private list is invisible to others; a shared one is open to them', async () => {
    const tag = `qa-private-${crypto.randomUUID()}`
    const prospectId = await newProspect(tag, 'free', { assignedUserId: null })
    const priv = await newList(ana, 'private')
    expect((await lists.listLists(bob)).find((l) => l.id === priv)).toBeUndefined()
    expect(await lists.addMembers(bob, priv, { ids: [prospectId] })).toBeUndefined()
    expect(await lists.removeMembers(bob, priv, [prospectId])).toBeUndefined()
    expect(await lists.updateList(bob, priv, { name: 'x' })).toBeUndefined()
    expect(await lists.deleteList(bob, priv)).toBe(false)

    const open = await newList(ana, 'open', { shared: true })
    expect(await lists.addMembers(bob, open, { ids: [prospectId] })).toMatchObject({ added: 1 })
    expect(await lists.updateList(bob, open, { name: 'x' })).toBeUndefined()
  })

  it('ids: added once, invisible and unknown ids counted', async () => {
    const tag = `qa-ids-${crypto.randomUUID()}`
    const mine = await newProspect(tag, 'mine')
    const bobs = await newProspect(tag, 'bobs', { assignedUserId: bob.id })
    const listId = await newList(ana, 'ids')
    const first = await lists.addMembers(ana, listId, { ids: [mine, bobs, crypto.randomUUID()] })
    expect(first).toEqual({ added: 1, skipped: { alreadyIn: 0, inFolderLists: 0, withoutPhone: 0, doNotContact: 0, notVisible: 2 } })
    expect(await lists.addMembers(ana, listId, { ids: [mine] })).toMatchObject({ added: 0, skipped: { alreadyIn: 1 } })
    expect(await membersOf(listId)).toBe(1)
    expect(await lists.removeMembers(ana, listId, [mine])).toEqual({ removed: 1 })
    expect(await lists.addMembers(ana, listId, { ids: [mine] })).toMatchObject({ added: 1 })
  })

  it('from a search: best score first, cut at the limit', async () => {
    const tag = `qa-limit-${crypto.randomUUID()}`
    const low = await newProspect(tag, 'low', { score: '10' })
    const high = await newProspect(tag, 'high', { score: '90' })
    const mid = await newProspect(tag, 'mid', { score: '50' })
    const listId = await newList(ana, 'limit')
    expect(await lists.addMembers(ana, listId, { ...search(tag), limit: 2 })).toMatchObject({ added: 2 })
    const kept = (await db.select().from(prospectListMembers).where(eq(prospectListMembers.listId, listId))).map((m) => m.prospectId)
    expect(kept.sort()).toEqual([high, mid].sort())
    expect(kept).not.toContain(low)
  })

  it('skipInFolderLists: a prospect already in another list of the same folder', async () => {
    const tag = `qa-folder-${crypto.randomUUID()}`
    const folder = await lists.createFolder(ana, { name: 'QA folder', shared: true })
    folderIds.push(folder.id)
    const [a, b] = [await newProspect(tag, 'a'), await newProspect(tag, 'b')]
    const other = await newList(ana, 'folder other', { folderId: folder.id })
    const target = await newList(ana, 'folder target', { folderId: folder.id })
    const outside = await newList(ana, 'outside folder')
    await lists.addMembers(ana, other, { ids: [a] })
    await lists.addMembers(ana, outside, { ids: [b] })
    const result = await lists.addMembers(ana, target, { ...search(tag), rules: { skipInFolderLists: true } })
    expect(result).toEqual({ added: 1, skipped: { alreadyIn: 0, inFolderLists: 1, withoutPhone: 0, doNotContact: 0, notVisible: 0 } })
    // Without the rule the same prospect goes in.
    const loose = await lists.addMembers(ana, target, search(tag))
    expect(loose).toMatchObject({ added: 1, skipped: { alreadyIn: 1 } })
  })

  it('skipWithoutPhone: no phone, or only invalid ones', async () => {
    const tag = `qa-phone-${crypto.randomUUID()}`
    const withPhone = await newProspect(tag, 'with')
    const none = await newProspect(tag, 'none')
    const invalid = await newProspect(tag, 'invalid')
    await addPhone(withPhone)
    await addPhone(invalid, 'invalid')
    const listId = await newList(ana, 'phone')
    const result = await lists.addMembers(ana, listId, { ...search(tag), rules: { skipWithoutPhone: true } })
    expect(result).toMatchObject({ added: 1, skipped: { withoutPhone: 2 } })
    const [member] = await db.select().from(prospectListMembers).where(eq(prospectListMembers.listId, listId))
    expect(member!.prospectId).toBe(withPhone)
    expect(none).not.toBe(invalid)
  })

  it('skipDoNotContact: only when every contact person says so; no people is fine', async () => {
    const tag = `qa-dnc-${crypto.randomUUID()}`
    const allBlocked = await newProspect(tag, 'all blocked')
    const mixed = await newProspect(tag, 'mixed')
    const nobody = await newProspect(tag, 'nobody')
    await addPerson(allBlocked, true)
    await addPerson(mixed, true)
    await addPerson(mixed, false)
    const listId = await newList(ana, 'dnc')
    const result = await lists.addMembers(ana, listId, { ...search(tag), rules: { skipDoNotContact: true } })
    expect(result).toMatchObject({ added: 2, skipped: { doNotContact: 1 } })
    const kept = (await db.select().from(prospectListMembers).where(eq(prospectListMembers.listId, listId))).map((m) => m.prospectId)
    expect(kept.sort()).toEqual([mixed, nobody].sort())
  })

  it('a search never reaches prospects the person cannot see', async () => {
    const tag = `qa-vis-${crypto.randomUUID()}`
    await newProspect(tag, 'bobs', { assignedUserId: bob.id })
    const listId = await newList(ana, 'vis')
    expect(await lists.addMembers(ana, listId, search(tag))).toMatchObject({ added: 0 })
  })
})

describe('folders', () => {
  it('deleting a folder leaves its lists without a folder', async () => {
    const folder = await lists.createFolder(ana, { name: 'QA doomed', shared: false })
    folderIds.push(folder.id)
    const listId = await newList(ana, 'in doomed', { folderId: folder.id })
    expect((await lists.listFolders(bob)).find((f) => f.id === folder.id)).toBeUndefined()
    expect(await lists.deleteFolder(bob, folder.id)).toBe(false)
    expect(await lists.deleteFolder(ana, folder.id)).toBe(true)
    expect((await lists.listLists(ana)).find((l) => l.id === listId)?.folderId).toBeNull()
    expect((await lists.listFolders(ana)).find((f) => f.id === folder.id)).toBeUndefined()
  })

  it('a list cannot go into a private folder of someone else', async () => {
    const folder = await lists.createFolder(ana, { name: 'QA private folder', shared: false })
    folderIds.push(folder.id)
    await expect(lists.createList(bob, { name: 'QA sneaky', shared: false, folderId: folder.id })).rejects.toBeInstanceOf(lists.FolderNotFoundError)
  })
})
