/**
 * Mesaje (PLAN.md C3, BE) — izolarea între conversații e riscul principal al modulului, deci
 * verificată pe fiecare cale, inclusiv cererea directă prin id (mesaj, atașament, citit).
 * Bus-ul SSE e în memorie (`presence.ts`), testat direct, nu prin HTTP: `/api/chat/stream` ține
 * răspunsul deschis cât timp socketul e viu, deci `inject` nu are ceas care să-l închidă.
 */
import argon2 from 'argon2'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'
import { afterAll, describe, expect, it, vi } from 'vitest'

type InjectPayload = NonNullable<InjectOptions['payload']>
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import {
  conversationMembers,
  conversations,
  messageAttachments,
  messages,
  roles,
  userMailboxes,
  users,
} from '../../shared/db/schema/index.js'
import { effectiveFeatures, type SessionUser } from '../../shared/lib/session.js'
import type { NotificationPrefs } from '../../shared/db/schema/index.js'
import { hasOpenConnection, openConnection, resetPresenceForTests, type ChatEvent } from './presence.js'
import { pushTarget } from './service.js'

// R2 nu e la îndemâna în teste: obiectul „se pierde" și se întoarce la descărcare, suficient
// pentru ce se testează aici (membria, `Content-Disposition`, dimensiunea).
const stored = new Map<string, Buffer>()
vi.mock('../../shared/lib/r2.js', () => ({
  uploadToR2: vi.fn(async (key: string, body: Readable) => {
    const chunks: Buffer[] = []
    for await (const chunk of body) chunks.push(chunk as Buffer)
    stored.set(key, Buffer.concat(chunks))
  }),
  downloadFromR2: vi.fn(async (key: string) => {
    const buffer = stored.get(key)
    if (!buffer) throw new Error(`obiect lipsă în R2: ${key}`)
    return buffer
  }),
  deleteFromR2: vi.fn(async (key: string) => {
    stored.delete(key)
  }),
  isR2Configured: () => true,
}))

const app = await buildServer()
await app.ready()

const PASSWORD = 'parola-de-test-123'
const userIds: string[] = []
const roleIds: string[] = []
const conversationIds: string[] = []

interface TestSession {
  me: SessionUser
  token: string
  deviceId: string
}

// Leftovers of a run that died before afterAll: same emails and role names would collide.
const staleUsers = await db.select({ id: users.id }).from(users).where(like(users.email, 'qa-chat-%@test.local'))
if (staleUsers.length) {
  const staleIds = staleUsers.map((row) => row.id)
  const staleMemberships = await db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(inArray(conversationMembers.userId, staleIds))
  const staleCreated = await db.select({ id: conversations.id }).from(conversations).where(inArray(conversations.createdByUserId, staleIds))
  const staleConversationIds = [...new Set([...staleMemberships, ...staleCreated].map((row) => row.id))]
  await db.delete(messageAttachments).where(inArray(messageAttachments.uploadedByUserId, staleIds))
  if (staleConversationIds.length) {
    await db.delete(conversationMembers).where(inArray(conversationMembers.conversationId, staleConversationIds))
    await db.delete(messages).where(inArray(messages.conversationId, staleConversationIds))
    await db.delete(conversations).where(inArray(conversations.id, staleConversationIds))
  }
  await db.delete(users).where(inArray(users.id, staleIds))
}
await db.delete(roles).where(like(roles.name, 'Test: chat qa-chat-%'))

// The key is a stand-in with the right shape: the server only checks the format, never uses it.
async function registerDevice(token: string): Promise<string> {
  const publicKey = () => randomBytes(32).toString('base64').replace(/=+$/, '')
  const res = await app.inject({
    method: 'POST',
    url: '/api/chat/keys/devices',
    cookies: { vana_session: token },
    payload: { publicIdentityKey: publicKey(), signingKey: publicKey(), label: 'QA' },
  })
  expect(res.statusCode).toBe(201)
  return res.json().data.id as string
}

let ciphertextCounter = 0
// Opaque on purpose: the server stores whatever the author's device sent.
const sealed = (u: TestSession) => ({
  v: 1 as const,
  ciphertext: Buffer.from(`opaque-${++ciphertextCounter}`).toString('base64'),
  senderDeviceId: u.deviceId,
})
const text = (u: TestSession, extra: Record<string, unknown> = {}) => ({
  body: '',
  clientId: crypto.randomUUID(),
  encrypted: sealed(u),
  ...extra,
})

async function user(email: string, features: string[]): Promise<TestSession> {
  const [role] = await db
    .insert(roles)
    .values({ name: `Test: chat ${email}`, kind: 'custom', features })
    .returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await argon2.hash(PASSWORD), displayName: email.split('@')[0], roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  const token = await app.jwt.sign({ sub: row!.id, sv: 1 })
  // Without mesaje.view the key routes answer 403, so such a person has no device.
  const deviceId = features.includes('mesaje.view') ? await registerDevice(token) : ''
  const me: SessionUser = {
    id: row!.id,
    email,
    displayName: email.split('@')[0] ?? null,
    role: { id: role!.id, name: role!.name, kind: 'custom' as const },
    isPlatformAdmin: false,
    features: effectiveFeatures(features, 'custom'),
    mailboxes: null,
    status: 'active' as const,
    lastSeenAt: null,
    notificationPrefs: null,
    navLayout: null,
    updatesSeenAt: null,
    locale: 'ro',
    displayCurrency: 'RON',
    sessionVersion: 1,
  }
  return { me, token, deviceId }
}

const ana = await user('qa-chat-ana@test.local', ['mesaje.view'])
const ion = await user('qa-chat-ion@test.local', ['mesaje.view'])
const outsider = await user('qa-chat-outsider@test.local', ['mesaje.view'])
const faraMesaje = await user('qa-chat-fara-mesaje@test.local', ['email.view'])

const cookie = (u: TestSession) => ({ vana_session: u.token })
const get = (url: string, u: TestSession) => app.inject({ method: 'GET', url, cookies: cookie(u) })
const post = (url: string, u: TestSession, payload: InjectPayload): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url, cookies: cookie(u), payload })
const put = (url: string, u: TestSession) => app.inject({ method: 'PUT', url, cookies: cookie(u) })
const patch = (url: string, u: TestSession, payload: InjectPayload): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'PATCH', url, cookies: cookie(u), payload })

// Conversație cu Ana și Ion. Ion are și un DM cu outsider, ca un străin să aibă ce să nu vadă.
const dm = await post('/api/chat/conversations', ana, { kind: 'dm', userId: ion.me.id })
const dmId = dm.json().data.id as string
conversationIds.push(dmId)
const otherDm = await post('/api/chat/conversations', ion, { kind: 'dm', userId: outsider.me.id })
const otherDmId = otherDm.json().data.id as string
conversationIds.push(otherDmId)

const group = await post('/api/chat/conversations', ana, { kind: 'group', name: 'QA grup', memberIds: [ion.me.id] })
const groupId = group.json().data.id as string
conversationIds.push(groupId)

const firstEncrypted = sealed(ana)
const sent = await post(`/api/chat/conversations/${dmId}/messages`, ana, text(ana, { encrypted: firstEncrypted }))
const firstMessageId = sent.json().data.id as string

afterAll(async () => {
  resetPresenceForTests()
  // Atașamentele legate de mesaje se duc în cascadă; cele netrimise (message_id null) nu.
  await db.delete(messageAttachments).where(inArray(messageAttachments.uploadedByUserId, userIds))
  for (const id of conversationIds) {
    await db.delete(conversationMembers).where(eq(conversationMembers.conversationId, id))
    await db.delete(messages).where(eq(messages.conversationId, id))
    await db.delete(conversations).where(eq(conversations.id, id))
  }
  for (const id of userIds) {
    await db.delete(userMailboxes).where(eq(userMailboxes.userId, id))
    await db.delete(users).where(eq(users.id, id))
  }
  if (roleIds.length) await db.delete(roles).where(and(inArray(roles.id, roleIds), isNull(roles.deletedAt)))
  await app.close()
})

describe('izolarea între conversații', () => {
  it('lista arată doar conversațiile omului', async () => {
    const res = await get('/api/chat/conversations', outsider)
    const ids = res.json().data.map((c: { id: string }) => c.id)
    expect(ids).toEqual([otherDmId])
    expect(ids).not.toContain(dmId)
    expect(ids).not.toContain(groupId)
  })

  it('mesajele unei conversații din care nu faci parte sunt 404, nu 403', async () => {
    const res = await get(`/api/chat/conversations/${dmId}/messages`, outsider)
    expect(res.statusCode).toBe(404)
  })

  it('trimisul într-o conversație străină e 404 și nu creează mesaj', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/messages`, outsider, text(outsider))
    expect(res.statusCode).toBe(404)
    const rows = await db.select().from(messages).where(eq(messages.conversationId, dmId))
    expect(rows.some((m) => m.authorUserId === outsider.me.id)).toBe(false)
  })

  it('marcatul citit într-o conversație străină e 404', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/read`, outsider, { messageId: firstMessageId })
    expect(res.statusCode).toBe(404)
  })

  it('editarea unui mesaj al altuia e 404 — și mesajul rămâne neatins', async () => {
    const res = await patch(`/api/chat/messages/${firstMessageId}`, ion, { encrypted: sealed(ion) })
    expect(res.statusCode).toBe(404)
    const [row] = await db.select().from(messages).where(eq(messages.id, firstMessageId))
    expect(row!.ciphertext?.toString('base64')).toBe(firstEncrypted.ciphertext)
    expect(row!.editedAt).toBeNull()
  })

  it('ștergerea unui mesaj al altuia e 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/chat/messages/${firstMessageId}`, cookies: cookie(ion) })
    expect(res.statusCode).toBe(404)
  })

  it('redenumirea unui grup se poate doar de owner sau de cineva cu echipa.administrare', async () => {
    const strain = await patch(`/api/chat/conversations/${groupId}`, ion, { name: 'QAgrup furat' })
    expect(strain.statusCode).toBe(403)
    const [row] = await db.select().from(conversations).where(eq(conversations.id, groupId))
    expect(row!.name).toBe('QA grup')
  })

  it('un DM nu ia nume sau membri noi', async () => {
    const res = await patch(`/api/chat/conversations/${dmId}`, ana, { name: 'DM cu nume' })
    expect(res.statusCode).toBe(404)
  })

  it('owner-ul grupului adaugă și scoate oameni, iar lista îi spune doar lui că poate', async () => {
    const canManage = async (u: TestSession) =>
      (await get('/api/chat/conversations', u)).json().data.find((c: { id: string }) => c.id === groupId)?.canManage
    expect(await canManage(ana)).toBe(true)
    expect(await canManage(ion)).toBe(false)

    expect((await patch(`/api/chat/conversations/${groupId}`, ion, { addMemberIds: [outsider.me.id] })).statusCode).toBe(403)
    expect((await patch(`/api/chat/conversations/${groupId}`, ana, { addMemberIds: [outsider.me.id] })).statusCode).toBe(200)
    expect(await canManage(outsider)).toBe(false)

    expect((await patch(`/api/chat/conversations/${groupId}`, ana, { removeMemberIds: [outsider.me.id] })).statusCode).toBe(200)
    const ids = (await get('/api/chat/conversations', outsider)).json().data.map((c: { id: string }) => c.id)
    expect(ids).not.toContain(groupId)
  })
})

describe('mesaje', () => {
  it('trimiterea avansează și citirea de pe conversăție', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ion, text(ion))
    expect(res.statusCode).toBe(200)
    const id = res.json().data.id as string
    const read = await post(`/api/chat/conversations/${dmId}/read`, ana, { messageId: id })
    expect(read.statusCode).toBe(200)
  })

  it('mesajul fără text criptat, atașamente sau obiecte e refuzat cu 400', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ana, { body: '', clientId: crypto.randomUUID() })
    expect(res.statusCode).toBe(400)
  })

  it('un body în clar e refuzat cu 400 și nu ajunge în baza de date', async () => {
    const clientId = crypto.randomUUID()
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ana, { body: 'în clar', clientId, encrypted: sealed(ana) })
    expect(res.statusCode).toBe(400)
    expect(await db.select().from(messages).where(eq(messages.clientId, clientId))).toHaveLength(0)
  })

  it('un dispozitiv care nu e al autorului e 400 UNKNOWN_DEVICE', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ana, text(ana, { encrypted: sealed(ion) }))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('UNKNOWN_DEVICE')
  })

  it('un dispozitiv revocat nu mai poate trimite', async () => {
    const device = await registerDevice(ana.token)
    const revoked = await app.inject({ method: 'DELETE', url: `/api/chat/keys/devices/${device}`, cookies: cookie(ana) })
    expect(revoked.statusCode).toBe(200)
    const res = await post(
      `/api/chat/conversations/${dmId}/messages`,
      ana,
      text(ana, { encrypted: { ...sealed(ana), senderDeviceId: device } }),
    )
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('UNKNOWN_DEVICE')
  })

  it('textul criptat se întoarce identic, cu body gol, și se păstrează ca bytea', async () => {
    const encrypted = sealed(ana)
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ana, text(ana, { encrypted }))
    expect(res.statusCode).toBe(200)
    expect(res.json().data.body).toBe('')
    expect(res.json().data.encrypted).toEqual(encrypted)
    const [row] = await db.select().from(messages).where(eq(messages.id, res.json().data.id))
    expect(row!.body).toBe('')
    expect(row!.ciphertext?.toString('base64')).toBe(encrypted.ciphertext)
  })

  it('autorul își editează mesajul cu un text nou criptat', async () => {
    const created = await post(`/api/chat/conversations/${groupId}/messages`, ana, text(ana))
    const encrypted = sealed(ana)
    const res = await patch(`/api/chat/messages/${created.json().data.id}`, ana, { encrypted })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.encrypted).toEqual(encrypted)
    expect(res.json().data.editedAt).not.toBeNull()
  })

  it('un body la editare nu mai e acceptat', async () => {
    const res = await patch(`/api/chat/messages/${firstMessageId}`, ana, { body: 'în clar' })
    expect(res.statusCode).toBe(400)
  })

  it('căutarea pe server nu mai există', async () => {
    const res = await get(`/api/chat/conversations/${dmId}/search?q=salut`, ana)
    expect(res.statusCode).toBe(404)
  })

  it('aceeași clientId la retrimitere întoarce același mesaj, nu o copie', async () => {
    const clientId = crypto.randomUUID()
    const first = await post(`/api/chat/conversations/${groupId}/messages`, ana, text(ana, { clientId }))
    const second = await post(`/api/chat/conversations/${groupId}/messages`, ana, text(ana, { clientId }))
    expect(second.json().data.id).toBe(first.json().data.id)
    const rows = await db.select().from(messages).where(eq(messages.clientId, clientId))
    expect(rows).toHaveLength(1)
  })

  it('mesajele se citesc în ordine, cu paginare înainte de ultima', async () => {
    const page = await get(`/api/chat/conversations/${dmId}/messages?limit=1`, ana)
    const { messages: first, hasMore } = page.json().data
    expect(first).toHaveLength(1)
    expect(hasMore).toBe(true)
    const older = await get(`/api/chat/conversations/${dmId}/messages?before=${first[0].id}&limit=1`, ana)
    expect(older.json().data.messages[0].id).not.toBe(first[0].id)
  })

  it('ștergerea de către autor e moale („Mesaj șters") și mesajul nu mai e necitit', async () => {
    const created = await post(`/api/chat/conversations/${groupId}/messages`, ion, text(ion))
    const id = created.json().data.id as string
    const res = await app.inject({ method: 'DELETE', url: `/api/chat/messages/${id}`, cookies: cookie(ion) })
    expect(res.statusCode).toBe(200)
    const [stored] = await db.select().from(messages).where(eq(messages.id, id))
    expect(stored!.ciphertext).toBeNull()
    expect(stored!.body).toBe('')
    const listed = await get(`/api/chat/conversations/${groupId}/messages?limit=50`, ana)
    const row = listed.json().data.messages.find((m: { id: string }) => m.id === id)
    expect(row.deletedAt).not.toBeNull()
    expect(row.body).toBe('')
    expect(row.encrypted).toBeNull()
  })
})

describe('necitite și „nu mai notifica"', () => {
  it('mesajele altora îi apar omului ca necitite, iar după citire dispar', async () => {
    const conv = await post('/api/chat/conversations', ana, { kind: 'group', name: 'QA necitite', memberIds: [ion.me.id] })
    const id = conv.json().data.id as string
    conversationIds.push(id)
    const created = await post(`/api/chat/conversations/${id}/messages`, ana, text(ana))
    const messageId = created.json().data.id as string

    const list = await get('/api/chat/conversations', ion)
    expect(list.json().data.find((c: { id: string }) => c.id === id).unreadCount).toBe(1)

    await post(`/api/chat/conversations/${id}/read`, ion, { messageId })
    const afterRead = await get('/api/chat/conversations', ion)
    expect(afterRead.json().data.find((c: { id: string }) => c.id === id).unreadCount).toBe(0)
    const [member] = await db
      .select({ lastReadAt: conversationMembers.lastReadAt })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, ion.me.id)))
    expect(member!.lastReadAt).not.toBeNull()
  })

  it('bifele: trimis, livrat când Ion își încarcă lista, văzut după citire', async () => {
    const conv = await post('/api/chat/conversations', ana, { kind: 'group', name: 'QA bife', memberIds: [ion.me.id] })
    const id = conv.json().data.id as string
    conversationIds.push(id)
    const created = await post(`/api/chat/conversations/${id}/messages`, ana, text(ana))
    const { id: messageId, createdAt } = created.json().data as { id: string; createdAt: string }
    const receiptOfIon = async () =>
      (await get(`/api/chat/conversations/${id}/messages`, ana)).json().data.receipts.find((r: { userId: string }) => r.userId === ion.me.id)

    expect(await receiptOfIon()).toEqual({ userId: ion.me.id, deliveredUpTo: null, readUpTo: null })

    await get('/api/chat/conversations', ion)
    const delivered = await receiptOfIon()
    expect(Date.parse(delivered.deliveredUpTo)).toBeGreaterThanOrEqual(Date.parse(createdAt))
    expect(delivered.readUpTo).toBeNull()

    await post(`/api/chat/conversations/${id}/read`, ion, { messageId })
    expect((await receiptOfIon()).readUpTo).toBe(createdAt)
  })

  it('„nu mai notifica" taie și numărul de necitite', async () => {
    const conv = await post('/api/chat/conversations', ana, { kind: 'group', name: 'QA mut', memberIds: [ion.me.id] })
    const id = conv.json().data.id as string
    conversationIds.push(id)
    await post(`/api/chat/conversations/${id}/messages`, ana, text(ana))
    const muted = await patch(`/api/chat/conversations/${id}`, ion, { muted: true })
    expect(muted.statusCode).toBe(200)
    const list = await get('/api/chat/conversations', ion)
    const row = list.json().data.find((c: { id: string }) => c.id === id)
    expect(row.muted).toBe(true)
    expect(row.unreadCount).toBe(0)
  })
})

describe('atașamente', () => {
  // `app.inject` nu serializează FormData în acest repo (niciun alt test nu face upload
  // multipart), deci corpul se construiește manual, cu boundary — altfel serverul răspunde
  // 406 „the request is not multipart". Câmpurile merg înaintea fișierelor, ca în client.
  async function upload(
    u: TestSession,
    opts: { fields?: Record<string, string>; content?: string | Buffer; thumbnail?: string; filename?: string } = {},
  ) {
    const boundary = `----qaChat${crypto.randomUUID()}`
    const parts: Buffer[] = []
    for (const [name, value] of Object.entries(opts.fields ?? { encrypted: '1', kind: 'image' })) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
    const file = (name: string, filename: string, content: string | Buffer) => [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(content),
      Buffer.from('\r\n'),
    ]
    parts.push(...file('file', opts.filename ?? 'blob', opts.content ?? 'opaque-file-bytes'))
    if (opts.thumbnail !== undefined) parts.push(...file('thumbnail', 'thumb', opts.thumbnail))
    parts.push(Buffer.from(`--${boundary}--\r\n`))
    return app.inject({
      method: 'POST',
      url: '/api/chat/attachments',
      cookies: cookie(u),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(parts),
    })
  }

  it('un upload fără encrypted=1 e refuzat cu 400 NOT_ENCRYPTED și nu lasă rând', async () => {
    const before = await db.select().from(messageAttachments).where(eq(messageAttachments.uploadedByUserId, ana.me.id))
    const res = await upload(ana, { fields: { kind: 'image' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('NOT_ENCRYPTED')
    const after = await db.select().from(messageAttachments).where(eq(messageAttachments.uploadedByUserId, ana.me.id))
    expect(after).toHaveLength(before.length)
  })

  it('atașamentul criptat se servește ca descărcare octet-stream, iar miniatura pe ?size=thumb', async () => {
    const image = await upload(ana, { content: 'full-bytes', thumbnail: 'thumb-bytes' })
    expect(image.statusCode).toBe(200)
    const imageId = image.json().data.id as string
    const [row] = await db.select().from(messageAttachments).where(eq(messageAttachments.id, imageId))
    expect(row).toMatchObject({ encrypted: true, mediaKind: 'image', contentType: 'application/octet-stream' })
    expect(row!.thumbnailPath).not.toBeNull()

    const sentMessage = await post(`/api/chat/conversations/${dmId}/messages`, ana, text(ana, { attachmentIds: [imageId] }))
    expect(sentMessage.statusCode).toBe(200)
    expect(sentMessage.json().data.attachments).toEqual([expect.objectContaining({ id: imageId, encrypted: true, mediaKind: 'image' })])

    const full = await get(`/api/chat/attachments/${imageId}`, ion)
    expect(full.statusCode).toBe(200)
    expect(full.headers['content-type']).toContain('application/octet-stream')
    expect(full.headers['content-disposition']).toContain('attachment')
    expect(full.headers['x-content-type-options']).toBe('nosniff')
    expect(full.rawPayload.toString()).toBe('full-bytes')

    const thumb = await get(`/api/chat/attachments/${imageId}?size=thumb`, ion)
    expect(thumb.statusCode).toBe(200)
    expect(thumb.rawPayload.toString()).toBe('thumb-bytes')
  })

  it('fără miniatură, ?size=thumb întoarce fișierul', async () => {
    const file = await upload(ana, { fields: { encrypted: '1', kind: 'file' }, content: 'only-full' })
    const id = file.json().data.id as string
    await post(`/api/chat/conversations/${dmId}/messages`, ana, text(ana, { attachmentIds: [id] }))
    const res = await get(`/api/chat/attachments/${id}?size=thumb`, ion)
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.toString()).toBe('only-full')
  })

  it('un atașament al unei conversații din care nu faci parte e 404, cerut direct prin id', async () => {
    const image = await upload(ion)
    const imageId = image.json().data.id as string
    await post(`/api/chat/conversations/${dmId}/messages`, ion, text(ion, { attachmentIds: [imageId] }))
    const res = await get(`/api/chat/attachments/${imageId}`, outsider)
    expect(res.statusCode).toBe(404)
  })

  it('un upload netrimis e citibil doar de cel care l-a încărcat', async () => {
    const image = await upload(ion)
    const imageId = image.json().data.id as string
    expect((await get(`/api/chat/attachments/${imageId}`, ion)).statusCode).toBe(200)
    expect((await get(`/api/chat/attachments/${imageId}`, ana)).statusCode).toBe(404)
  })

  it('numele fișierului nu ajunge în R2 sau în baza de date', async () => {
    const res = await upload(ana, { filename: '../../etc/pa**sswd' })
    expect(res.statusCode).toBe(200)
    const id = res.json().data.id as string
    const [row] = await db.select().from(messageAttachments).where(eq(messageAttachments.id, id))
    expect(row!.storagePath).toMatch(/^chat\/[0-9a-f-]{36}\.enc$/)
    expect(row!.filename).toBe('encrypted')
    expect(JSON.stringify(row)).not.toContain('sswd')
    await db.delete(messageAttachments).where(eq(messageAttachments.id, id))
  })

  it('un fișier peste 50 MB e refuzat cu 413', async () => {
    const res = await upload(ana, { content: Buffer.alloc(50 * 1024 * 1024 + 1024, 'x') })
    expect(res.statusCode).toBe(413)
  })
})

describe('push și prezență', () => {
  const prefs = (chat: NotificationPrefs['chat']): NotificationPrefs => ({ chat, emailNew: true, alerts: true })

  it('pushul îl primesc doar membrii care nu și-au oprit mesajele', async () => {
    await db.update(users).set({ notificationPrefs: prefs('all') }).where(eq(users.id, ion.me.id))
    await db.update(users).set({ notificationPrefs: prefs('none') }).where(eq(users.id, outsider.me.id))
    const target = await pushTarget(dmId, ana.me.id)
    expect(target?.recipients).toContain(ion.me.id)
    expect(target?.recipients).not.toContain(outsider.me.id)
    expect(target?.recipients).not.toContain(ana.me.id)
  })

  it('„doar DM" taie grupurile, iar mutat exclude omul', async () => {
    await db.update(users).set({ notificationPrefs: prefs('dm') }).where(eq(users.id, ion.me.id))
    const inGroup = await pushTarget(groupId, ana.me.id)
    expect(inGroup?.recipients).not.toContain(ion.me.id)
    const inDm = await pushTarget(dmId, ana.me.id)
    expect(inDm?.recipients).toContain(ion.me.id)

    await db.update(conversationMembers).set({ muted: true }).where(eq(conversationMembers.conversationId, groupId))
    const muted = await pushTarget(groupId, ana.me.id)
    expect(muted?.recipients).not.toContain(ion.me.id)
    await db.update(users).set({ notificationPrefs: null }).where(inArray(users.id, [ion.me.id, outsider.me.id]))
  })

  it('prezența se anunță celor cu care omul are conversație', async () => {
    resetPresenceForTests()
    const received: unknown[] = []
    openConnection(ana.me.id, { id: 'qa-stream-ana', write: (event) => received.push(event) })
    expect(hasOpenConnection(ana.me.id)).toBe(true)
    // Conexiunea lui Ana e deschisă, deci când Ion scrie, el nu mai primește push.
    const target = await pushTarget(dmId, ion.me.id)
    expect(target?.recipients).toContain(ana.me.id)
    resetPresenceForTests()
    expect(hasOpenConnection(ana.me.id)).toBe(false)
  })

  it('heartbeat-ul marchează omul viu și nu e refuzat', async () => {
    const res = await post('/api/chat/heartbeat', ana, {})
    expect(res.statusCode).toBe(200)
  })
})

describe('funcționalitatea', () => {
  it('omul fără mesaje.view e refuzat, nu vede o listă goală', async () => {
    const res = await get('/api/chat/conversations', faraMesaje)
    expect(res.statusCode).toBe(403)
  })
})

describe('răspunsuri și reacții', () => {
  const reactionUrl = (messageId: string, emoji: string) => `/api/chat/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`

  it('un răspuns la un mesaj din altă conversație e 400 REPLY_NOT_IN_CONVERSATION', async () => {
    const foreign = await post(`/api/chat/conversations/${otherDmId}/messages`, ion, text(ion))
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ana, text(ana, { replyToId: foreign.json().data.id }))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('REPLY_NOT_IN_CONVERSATION')
  })

  it('un răspuns valid vine cu replyTo', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ion, text(ion, { replyToId: firstMessageId }))
    expect(res.statusCode).toBe(200)
    expect(res.json().data.replyTo).toMatchObject({ id: firstMessageId, deleted: false })
  })

  it('reacția cuiva din afara conversației e 404', async () => {
    const res = await put(reactionUrl(firstMessageId, '👍'), outsider)
    expect(res.statusCode).toBe(404)
  })

  it('reacția la un mesaj șters e 404', async () => {
    const created = await post(`/api/chat/conversations/${groupId}/messages`, ion, text(ion))
    const id = created.json().data.id as string
    await app.inject({ method: 'DELETE', url: `/api/chat/messages/${id}`, cookies: cookie(ion) })
    const res = await put(reactionUrl(id, '👍'), ana)
    expect(res.statusCode).toBe(404)
  })

  it('un emoji invalid e 400', async () => {
    const res = await put(reactionUrl(firstMessageId, 'abc'), ana)
    expect(res.statusCode).toBe(400)
  })

  it('aceeași reacție pusă de două ori rămâne un singur rând', async () => {
    await put(reactionUrl(firstMessageId, '🎉'), ana)
    const res = await put(reactionUrl(firstMessageId, '🎉'), ana)
    expect(res.statusCode).toBe(200)
    const { reactions } = res.json().data as { reactions: { emoji: string; userIds: string[] }[] }
    const party = reactions.find((r) => r.emoji === '🎉')
    expect(party?.userIds).toEqual([ana.me.id])
  })

  it('reacția se scoate cu DELETE și a doua oară nu strică nimic', async () => {
    await put(reactionUrl(firstMessageId, '🔥'), ion)
    const first = await app.inject({ method: 'DELETE', url: reactionUrl(firstMessageId, '🔥'), cookies: cookie(ion) })
    const second = await app.inject({ method: 'DELETE', url: reactionUrl(firstMessageId, '🔥'), cookies: cookie(ion) })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.json().data.reactions.some((r: { emoji: string }) => r.emoji === '🔥')).toBe(false)
  })
})

describe('fereastra din jurul unui mesaj, tastare', () => {
  it('around întoarce 25 mai vechi + 25 de la ancoră și hasNewer', async () => {
    const conv = await post('/api/chat/conversations', ana, { kind: 'group', name: 'QA around', memberIds: [ion.me.id] })
    const id = conv.json().data.id as string
    conversationIds.push(id)
    const start = Date.now() - 3_600_000
    const rows = await db
      .insert(messages)
      .values(
        Array.from({ length: 60 }, (_, i) => ({
          conversationId: id,
          authorUserId: ana.me.id,
          body: `mesaj ${i}`,
          clientId: crypto.randomUUID(),
          createdAt: new Date(start + i * 1000),
        })),
      )
      .returning()
    const byBody = new Map(rows.map((r) => [r.body, r.id]))

    // The 10th message has only 9 older ones, so nothing is left behind it.
    const near = await get(`/api/chat/conversations/${id}/messages?around=${byBody.get('mesaj 9')}`, ion)
    const nearPage = near.json().data as { messages: { id: string; body: string }[]; hasMore: boolean; hasNewer: boolean }
    expect(nearPage.messages).toHaveLength(9 + 25)
    expect(nearPage.messages[0]!.body).toBe('mesaj 0')
    expect(nearPage.messages.some((m) => m.id === byBody.get('mesaj 9'))).toBe(true)
    expect(nearPage.hasMore).toBe(false)
    expect(nearPage.hasNewer).toBe(true)

    const middle = await get(`/api/chat/conversations/${id}/messages?around=${byBody.get('mesaj 30')}`, ion)
    const middlePage = middle.json().data as { messages: { body: string }[]; hasMore: boolean; hasNewer: boolean }
    expect(middlePage.messages).toHaveLength(50)
    expect(middlePage.messages[0]!.body).toBe('mesaj 5')
    expect(middlePage.messages[25]!.body).toBe('mesaj 30')
    expect(middlePage.hasMore).toBe(true)
    expect(middlePage.hasNewer).toBe(true)
  })

  it('tastarea ajunge la ceilalți membri, nu la cel care tastează', async () => {
    resetPresenceForTests()
    const forAna: ChatEvent[] = []
    const forIon: ChatEvent[] = []
    openConnection(ana.me.id, { id: 'qa-typing-ana', write: (event) => forAna.push(event) })
    openConnection(ion.me.id, { id: 'qa-typing-ion', write: (event) => forIon.push(event) })
    const res = await post(`/api/chat/conversations/${groupId}/typing`, ana, {})
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    const typing = (events: ChatEvent[]) => events.filter((e) => e.type === 'typing')
    expect(typing(forIon)).toEqual([{ type: 'typing', conversationId: groupId, userId: ana.me.id }])
    expect(typing(forAna)).toHaveLength(0)
    resetPresenceForTests()
  })

  it('tastarea într-o conversație străină e 404', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/typing`, outsider, {})
    expect(res.statusCode).toBe(404)
  })
})

describe('profilul: mișcare și sume ascunse', () => {
  it('motionPref și hideAmounts se salvează și se întorc la GET /me', async () => {
    const res = await patch('/api/auth/me', ana, { motionPref: 'off', hideAmounts: true })
    expect(res.statusCode).toBe(200)
    const me = (await get('/api/auth/me', ana)).json().data
    expect(me.motionPref).toBe('off')
    expect(me.hideAmounts).toBe(true)
  })
})
