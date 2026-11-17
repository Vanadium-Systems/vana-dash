/**
 * HTTP route tests for Notes (B15 / QA4): CRUD, owner isolation (404), conflict 409 with
 * `details.current`, invalid UUID 400, archive/trash/restore, labels, bulk actions, and versions.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { notes, roles, users } from '../../shared/db/schema/index.js'
import { sanitizeTiptapDoc } from '../../shared/lib/tiptap-text.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const userIds: string[] = []
const roleIds: string[] = []

async function makeUser(label: string) {
  const [role] = await db
    .insert(roles)
    .values({ name: `QA notes ${label} ${RUN}`, kind: 'custom', features: ['notite.view'] })
    .returning()
  roleIds.push(role!.id)
  const [user] = await db
    .insert(users)
    .values({
      email: `notes-${label}-${RUN}@example.com`,
      passwordHash: await argon2.hash('acme-test-password'),
      displayName: `QA ${label}`,
      roleId: role!.id,
    })
    .returning()
  userIds.push(user!.id)
  const token = await app.jwt.sign({ sub: user!.id, sv: 1 })
  return { id: user!.id, cookie: `vana_session=${token}` }
}

const owner = await makeUser('owner')
const other = await makeUser('other')

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

afterAll(async () => {
  await db.delete(notes).where(inArray(notes.ownerUserId, userIds))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

describe('Notes HTTP routes', () => {
  it('validates UUID params and rejects non-array marks in Tiptap docs', async () => {
    const badId = await app.inject({
      method: 'GET',
      url: '/api/notes/not-a-uuid',
      headers: { cookie: owner.cookie },
    })
    expect(badId.statusCode).toBe(400)
    expect(badId.json().error.code).toBe('VALIDATION_FAILED')

    expect(() =>
      sanitizeTiptapDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: 'bold' }] }],
      }),
    ).toThrow()

    const badBody = await app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { cookie: owner.cookie },
      payload: {
        title: 'Bad marks',
        bodyJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: { type: 'bold' } }] }],
        },
      },
    })
    expect(badBody.statusCode).toBe(400)
    expect(badBody.json().error.code).toBe('INVALID_BODY')
  })

  it('supports CRUD, 409 NOTE_CHANGED with current snapshot, and owner isolation (404)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { cookie: owner.cookie },
      payload: { title: 'Route note', bodyJson: doc('initial'), labels: ['alpha'] },
    })
    expect(created.statusCode).toBe(201)
    const note = created.json().data
    expect(note.id).toBeTruthy()

    const foreignGet = await app.inject({
      method: 'GET',
      url: `/api/notes/${note.id}`,
      headers: { cookie: other.cookie },
    })
    expect(foreignGet.statusCode).toBe(404)
    expect(foreignGet.json().error.code).toBe('NOTE_NOT_FOUND')

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/notes/${note.id}`,
      headers: { cookie: owner.cookie },
      payload: { bodyJson: doc('v2'), expectedUpdatedAt: note.updatedAt },
    })
    expect(updated.statusCode).toBe(200)

    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/notes/${note.id}`,
      headers: { cookie: owner.cookie },
      payload: { bodyJson: doc('stale'), expectedUpdatedAt: note.updatedAt },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error.code).toBe('NOTE_CHANGED')
    expect(conflict.json().error.current.body).toBe('v2')

    const versionsRes = await app.inject({
      method: 'GET',
      url: `/api/notes/${note.id}/versions`,
      headers: { cookie: owner.cookie },
    })
    expect(versionsRes.statusCode).toBe(200)
    const vid = versionsRes.json().data[0].id

    const foreignVersion = await app.inject({
      method: 'GET',
      url: `/api/notes/${note.id}/versions/${vid}`,
      headers: { cookie: other.cookie },
    })
    expect(foreignVersion.statusCode).toBe(404)

    const archived = await app.inject({
      method: 'PATCH',
      url: `/api/notes/${note.id}/archive`,
      headers: { cookie: owner.cookie },
    })
    expect(archived.statusCode).toBe(200)
    expect(archived.json().data.archivedAt).toBeTruthy()

    const unarchived = await app.inject({
      method: 'PATCH',
      url: `/api/notes/${note.id}/unarchive`,
      headers: { cookie: owner.cookie },
    })
    expect(unarchived.statusCode).toBe(200)
    expect(unarchived.json().data.archivedAt).toBeNull()

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/notes/${note.id}`,
      headers: { cookie: owner.cookie },
    })
    expect(del.statusCode).toBe(200)

    const empty = await app.inject({
      method: 'DELETE',
      url: '/api/notes/trash',
      headers: { cookie: owner.cookie },
    })
    expect(empty.statusCode).toBe(200)
    expect(empty.json().data.deleted).toBeGreaterThanOrEqual(1)
  })

  it('handles labels and bulk updates for the owner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { cookie: owner.cookie },
      payload: { title: 'Bulk route', bodyJson: doc('hello'), labels: ['temp'] },
    })
    const id = res.json().data.id

    const bulkColor = await app.inject({
      method: 'POST',
      url: '/api/notes/bulk',
      headers: { cookie: owner.cookie },
      payload: { ids: [id], action: 'color', value: 3 },
    })
    expect(bulkColor.statusCode).toBe(200)

    const labelsRes = await app.inject({
      method: 'GET',
      url: '/api/notes/labels',
      headers: { cookie: owner.cookie },
    })
    expect(labelsRes.statusCode).toBe(200)
    expect(labelsRes.json().data.some((l: { name: string }) => l.name === 'temp')).toBe(true)

    const removeLabel = await app.inject({
      method: 'DELETE',
      url: '/api/notes/labels/temp',
      headers: { cookie: owner.cookie },
    })
    expect(removeLabel.statusCode).toBe(200)

    const [row] = await db.select({ color: notes.color, labels: notes.labels }).from(notes).where(eq(notes.id, id))
    expect(row?.color).toBe(3)
    expect(row?.labels).toEqual([])
  })
})
