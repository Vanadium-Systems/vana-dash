/**
 * Notes as personal data (every path filters on the owner), saving with conflicts, versions,
 * labels, bulk, Ctrl K and the Plan move. Real Postgres.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { noteVersions, notes, planGoals } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { tiptapToText, sanitizeTiptapDoc } from '../../shared/lib/tiptap-text.js'
import * as service from './service.js'
import * as versions from './versions.js'
import { search } from '../search/service.js'
import { moveGoal } from '../plan/service.js'

const userIds: string[] = []
const me = await createTestUser('notes me', userIds, { features: ['notite.view'] })
const other = await createTestUser('notes other', userIds, { features: ['notite.view'] })

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
})

afterAll(async () => {
  await db.delete(planGoals).where(inArray(planGoals.ownerUserId, userIds))
  await db.delete(notes).where(inArray(notes.ownerUserId, userIds))
  await cleanupTestUsers(userIds)
})

describe('tiptapToText', () => {
  it('reads lists, tasks, headings and code as lines', () => {
    const text = tiptapToText({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Titlu' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unu' }] }] }] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'gata' }] }] },
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'de făcut' }] }] },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
      ],
    })
    expect(text.split('\n').filter(Boolean)).toEqual(['Titlu', '- unu', '[x] gata', '[ ] de făcut', 'x = 1'])
  })

  it('drops javascript: links and refuses a doc that is too deep', () => {
    const clean = sanitizeTiptapDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
    })
    expect(clean.content?.[0]?.content?.[0]?.marks).toEqual([])
    let deep: Record<string, unknown> = { type: 'text', text: 'x' }
    for (let i = 0; i < 40; i++) deep = { type: 'blockquote', content: [deep] }
    expect(() => sanitizeTiptapDoc({ type: 'doc', content: [deep] })).toThrow()
  })
})

describe('a note is its owner alone', () => {
  it("another person's note is 404 by id, in bulk, in versions and absent from Ctrl K", async () => {
    const note = (await service.createNote(me, { title: 'Secret QA-notes-xyz', bodyJson: doc('corp') }))!
    await expect(service.getNote(other, note.id)).rejects.toThrow(service.NoteNotFoundError)
    await expect(service.updateNote(other, note.id, { title: 'x' })).rejects.toThrow(service.NoteNotFoundError)
    await expect(service.bulkUpdate(other, [note.id], 'archive')).rejects.toThrow(service.NoteNotFoundError)
    await expect(versions.listVersions(other, note.id)).rejects.toThrow(service.NoteNotFoundError)
    const groups = await search(other, 'QA-notes-xyz')
    expect(groups.find((g) => g.feature === 'notite.view')).toBeUndefined()
    const mine = await search(me, 'qa-notes-xyz')
    expect(mine.find((g) => g.feature === 'notite.view')?.items[0]?.to).toBe(`/notes?note=${note.id}`)
  })

  it('a bulk with one foreign id changes nothing', async () => {
    const mine = (await service.createNote(me, { title: 'bulk mine' }))!
    const theirs = (await service.createNote(other, { title: 'bulk theirs' }))!
    await expect(service.bulkUpdate(me, [mine.id, theirs.id], 'pin')).rejects.toThrow(service.NoteNotFoundError)
    expect((await service.getNote(me, mine.id)).pinned).toBe(false)
  })
})

describe('saving', () => {
  it('an empty note is refused', async () => {
    await expect(service.createNote(me, { title: '  ', bodyJson: doc('') })).rejects.toMatchObject({ code: 'EMPTY_NOTE' })
  })

  it('the server derives the plain body and a stale save is a conflict', async () => {
    const note = (await service.createNote(me, { bodyJson: doc('prima') }))!
    expect(note.body).toBe('prima')
    expect(note.bodyFormat).toBe('rich')
    const saved = await service.updateNote(me, note.id, { bodyJson: doc('a doua'), expectedUpdatedAt: note.updatedAt.toISOString() })
    expect(saved.body).toBe('a doua')
    await expect(
      service.updateNote(me, note.id, { bodyJson: doc('a treia'), expectedUpdatedAt: note.updatedAt.toISOString() }),
    ).rejects.toThrow(service.NoteChangedError)
  })

  it('pinning does not move updatedAt nor conflict with the next save', async () => {
    const note = (await service.createNote(me, { title: 'pin', bodyJson: doc('x') }))!
    const pinned = await service.updateNote(me, note.id, { pinned: true })
    expect(pinned.updatedAt.getTime()).toBe(note.updatedAt.getTime())
    await expect(service.updateNote(me, note.id, { bodyJson: doc('y'), expectedUpdatedAt: note.updatedAt.toISOString() })).resolves.toBeDefined()
  })

  it('an old plain note keeps its text', async () => {
    const [row] = await db.insert(notes).values({ ownerUserId: me.id, title: 'veche', body: 'rând 1\nrând 2' }).returning()
    const note = await service.getNote(me, row!.id)
    expect(note.bodyFormat).toBe('plain')
    expect(note.body).toBe('rând 1\nrând 2')
  })
})

describe('versions', () => {
  it('a new version only after 10 minutes, at most 50, and restore keeps the current one', async () => {
    const note = (await service.createNote(me, { title: 'v', bodyJson: doc('v0') }))!
    await service.updateNote(me, note.id, { bodyJson: doc('v1') })
    await service.updateNote(me, note.id, { bodyJson: doc('v2') })
    expect(await versions.listVersions(me, note.id)).toHaveLength(1)

    await db.update(noteVersions).set({ createdAt: sql`now() - interval '11 minutes'` }).where(eq(noteVersions.noteId, note.id))
    await service.updateNote(me, note.id, { bodyJson: doc('v3') })
    const list = await versions.listVersions(me, note.id)
    expect(list).toHaveLength(2)

    const first = list[list.length - 1]!
    const restored = await versions.restoreVersion(me, note.id, first.id)
    expect(restored.body).toBe('v0')
    expect(await versions.listVersions(me, note.id)).toHaveLength(3)

    await db.insert(noteVersions).values(Array.from({ length: 60 }, () => ({ noteId: note.id, title: 'v', body: 'old' })))
    await db.update(noteVersions).set({ createdAt: sql`now() - interval '1 hour'` }).where(eq(noteVersions.noteId, note.id))
    await service.updateNote(me, note.id, { bodyJson: doc('v4') })
    expect(await versions.listVersions(me, note.id)).toHaveLength(50)
  })
})

describe('trash and labels', () => {
  it('restore after 31 days is 404', async () => {
    const note = (await service.createNote(me, { title: 'old trash' }))!
    await service.deleteNote(me, note.id)
    await db.update(notes).set({ deletedAt: sql`now() - interval '31 days'` }).where(eq(notes.id, note.id))
    await expect(service.restoreNote(me, note.id)).rejects.toThrow(service.NoteNotFoundError)
  })

  it('renaming a label changes it on every note of the person, and only theirs', async () => {
    const a = (await service.createNote(me, { title: 'la', labels: ['idei'] }))!
    const b = (await service.createNote(me, { title: 'lb', labels: ['idei', 'proiecte'] }))!
    const c = (await service.createNote(other, { title: 'lc', labels: ['idei'] }))!
    await service.changeLabel(me, 'idei', 'proiecte')
    expect((await service.getNote(me, a.id)).labels).toEqual(['proiecte'])
    expect((await service.getNote(me, b.id)).labels).toEqual(['proiecte'])
    expect((await service.getNote(other, c.id)).labels).toEqual(['idei'])
  })
})

describe('plan move', () => {
  it('moving between tiers renumbers both', async () => {
    const goals: (typeof planGoals.$inferSelect)[] = []
    for (const [tier, title] of [[1, 'a'], [1, 'b'], [1, 'c'], [2, 'x'], [2, 'y']] as const) {
      const [row] = await db
        .insert(planGoals)
        .values({ ownerUserId: me.id, scope: 'personal', tier, position: goals.filter((g) => g.tier === tier).length + 1, title })
        .returning()
      goals.push(row!)
    }
    const b = goals.find((g) => g.title === 'b')!
    await moveGoal(me, b.id, 2, 1)
    const rows = await db.select().from(planGoals).where(eq(planGoals.ownerUserId, me.id))
    const order = (tier: number) => rows.filter((r) => r.tier === tier).sort((p, q) => p.position - q.position).map((r) => `${r.title}${r.position}`)
    expect(order(1)).toEqual(['a1', 'c2'])
    expect(order(2)).toEqual(['b1', 'x2', 'y3'])
    expect(await moveGoal(other, b.id, 1, 1)).toBeNull()
  })
})
