/**
 * Objects shared into Mesaje: what a reader sees depends on the object's kind (firm objects are
 * live for whoever has the page's feature, personal ones come from the sender's snapshot) and
 * the sender can only share what they can see themselves.
 */
import argon2 from 'argon2'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import {
  archiveFiles,
  archiveFolders,
  conversationMembers,
  conversations,
  messageReactions,
  messageRefs,
  messages,
  notes,
  prospects,
  roles,
  users,
} from '../../shared/db/schema/index.js'

type InjectPayload = NonNullable<InjectOptions['payload']>

// The size check runs before anything is read from R2, so no bucket is needed.
vi.mock('../../shared/lib/r2.js', () => ({
  uploadToR2: vi.fn(),
  downloadFromR2: vi.fn(),
  deleteFromR2: vi.fn(),
  isR2Configured: () => true,
}))

const app = await buildServer()
await app.ready()

const userIds: string[] = []
const roleIds: string[] = []
const conversationIds: string[] = []
const prospectIds: string[] = []
const noteIds: string[] = []
const folderIds: string[] = []

interface TestSession {
  id: string
  token: string
}

async function user(email: string, features: string[]): Promise<TestSession> {
  const [role] = await db.insert(roles).values({ name: `Test: refs ${email}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await argon2.hash('parola-de-test-123'), displayName: email.split('@')[0], roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

const sender = await user('qa-refs-sender@test.local', ['mesaje.view', 'clienti.view', 'arhiva.view'])
const plainReader = await user('qa-refs-plain@test.local', ['mesaje.view'])
const clientsReader = await user('qa-refs-clients@test.local', ['mesaje.view', 'clienti.view'])
const stranger = await user('qa-refs-stranger@test.local', ['mesaje.view'])

const cookie = (u: TestSession) => ({ vana_session: u.token })
const get = (url: string, u: TestSession) => app.inject({ method: 'GET', url, cookies: cookie(u) })
const post = (url: string, u: TestSession, payload: InjectPayload): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url, cookies: cookie(u), payload })

async function conversationWith(creator: TestSession, memberIds: string[]): Promise<string> {
  const res = await post('/api/chat/conversations', creator, { kind: 'group', name: 'QA refs', memberIds })
  const id = res.json().data.id as string
  conversationIds.push(id)
  return id
}

const sendRef = (conversationId: string, from: TestSession, ref: { type: string; id: string }) =>
  post(`/api/chat/conversations/${conversationId}/messages`, from, { body: '', clientId: crypto.randomUUID(), refs: [ref] })

const readRefs = async (conversationId: string, reader: TestSession) => {
  const res = await get(`/api/chat/conversations/${conversationId}/messages`, reader)
  return res.json().data.messages.flatMap((m: { refs: unknown[] }) => m.refs) as {
    state: string
    refId: string | null
    canOpen: boolean
    card: Record<string, unknown>
    grantors?: { userId: string; name: string }[]
  }[]
}

const [prospect] = await db.insert(prospects).values({ name: 'Acme Prospect QA SRL' }).returning()
prospectIds.push(prospect!.id)
const [note] = await db.insert(notes).values({ ownerUserId: sender.id, title: 'Acme note', body: 'Private body' }).returning()
noteIds.push(note!.id)

afterAll(async () => {
  for (const id of conversationIds) {
    await db.delete(conversationMembers).where(eq(conversationMembers.conversationId, id))
    await db.delete(messages).where(eq(messages.conversationId, id))
    await db.delete(conversations).where(eq(conversations.id, id))
  }
  if (folderIds.length) {
    await db.delete(archiveFiles).where(inArray(archiveFiles.folderId, folderIds))
    await db.delete(archiveFolders).where(inArray(archiveFolders.id, folderIds))
  }
  if (noteIds.length) await db.delete(notes).where(inArray(notes.id, noteIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  for (const id of userIds) await db.delete(users).where(eq(users.id, id))
  if (roleIds.length) await db.delete(roles).where(and(inArray(roles.id, roleIds), isNull(roles.deletedAt)))
  await app.close()
})

describe('obiecte trimise în mesaje', () => {
  it('un prospect citit de cineva fără clienti.view e „denied", fără refId și doar cu titlu', async () => {
    const id = await conversationWith(sender, [plainReader.id, clientsReader.id])
    const sent = await sendRef(id, sender, { type: 'prospect', id: prospect!.id })
    expect(sent.statusCode).toBe(200)

    const [denied] = await readRefs(id, plainReader)
    expect(denied!.state).toBe('denied')
    expect(denied!.refId).toBeNull()
    expect(Object.keys(denied!.card)).toEqual(['title'])
    // Access to Clienți comes with a role, so the card names who manages the team, not the sender.
    expect(denied!.grantors?.length).toBeGreaterThan(0)
    expect(denied!.grantors!.some((g) => g.userId === plainReader.id)).toBe(false)

    const [live] = await readRefs(id, clientsReader)
    expect(live!.state).toBe('live')
    expect(live!.refId).toBe(prospect!.id)
    expect(live!.canOpen).toBe(true)
  })

  it('o notiță trimisă: cititorul primește snapshot fără acces, autorul o poate deschide', async () => {
    const id = await conversationWith(sender, [plainReader.id])
    await sendRef(id, sender, { type: 'note', id: note!.id })

    const [forReader] = await readRefs(id, plainReader)
    expect(forReader!.state).toBe('snapshot')
    expect(forReader!.refId).toBeNull()
    expect(forReader!.canOpen).toBe(false)
    expect(forReader!.card.title).toBe('Acme note')

    const [forOwner] = await readRefs(id, sender)
    expect(forOwner!.canOpen).toBe(true)
    expect(forOwner!.refId).toBe(note!.id)
  })

  it('un obiect pe care expeditorul nu îl vede (notița altcuiva) e 404 și nu creează mesaj', async () => {
    const id = await conversationWith(plainReader, [sender.id])
    const res = await sendRef(id, plainReader, { type: 'note', id: note!.id })
    expect(res.statusCode).toBe(404)
    const rows = await db.select().from(messages).where(eq(messages.conversationId, id))
    expect(rows).toHaveLength(0)
  })

  it('un fișier din Arhivă peste 20 MB e 413 REF_FILE_TOO_LARGE', async () => {
    const [folder] = await db.insert(archiveFolders).values({ name: 'QA refs', ownerUserId: sender.id }).returning()
    folderIds.push(folder!.id)
    const [file] = await db
      .insert(archiveFiles)
      .values({
        folderId: folder!.id,
        name: 'mare.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 21 * 1024 * 1024,
        r2Key: `archive/qa-refs-${crypto.randomUUID()}`,
      })
      .returning()
    const id = await conversationWith(sender, [plainReader.id])
    const res = await sendRef(id, sender, { type: 'archive_file', id: file!.id })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('REF_FILE_TOO_LARGE')
  })

  it('ștergerea mesajului șterge și obiectele și reacțiile lui', async () => {
    const id = await conversationWith(sender, [plainReader.id])
    const sent = await sendRef(id, sender, { type: 'note', id: note!.id })
    const messageId = sent.json().data.id as string
    const reaction = await app.inject({
      method: 'PUT',
      url: `/api/chat/messages/${messageId}/reactions/${encodeURIComponent('👍')}`,
      cookies: cookie(plainReader),
    })
    expect(reaction.statusCode).toBe(200)
    expect(await db.select().from(messageRefs).where(eq(messageRefs.messageId, messageId))).toHaveLength(1)
    expect(await db.select().from(messageReactions).where(eq(messageReactions.messageId, messageId))).toHaveLength(1)

    const del = await app.inject({ method: 'DELETE', url: `/api/chat/messages/${messageId}`, cookies: cookie(sender) })
    expect(del.statusCode).toBe(200)
    expect(await db.select().from(messageRefs).where(eq(messageRefs.messageId, messageId))).toHaveLength(0)
    expect(await db.select().from(messageReactions).where(eq(messageReactions.messageId, messageId))).toHaveLength(0)
  })

  it('GET /api/chat/refs nu listează conversațiile din care cititorul nu face parte', async () => {
    const shared = await conversationWith(sender, [plainReader.id])
    const hidden = await conversationWith(sender, [stranger.id])
    await sendRef(shared, sender, { type: 'prospect', id: prospect!.id })
    await sendRef(hidden, sender, { type: 'prospect', id: prospect!.id })

    const res = await get(`/api/chat/refs?type=prospect&id=${prospect!.id}`, plainReader)
    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((r: { conversationId: string }) => r.conversationId)
    expect(ids).toContain(shared)
    expect(ids).not.toContain(hidden)
  })
})
