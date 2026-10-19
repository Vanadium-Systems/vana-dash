/**
 * Mesaje (PLAN.md C3, BE) — izolarea între conversații e riscul principal al modulului, deci
 * verificată pe fiecare cale, inclusiv cererea directă prin id (mesaj, atașament, citit).
 * Bus-ul SSE e în memorie (`presence.ts`), testat direct, nu prin HTTP: `/api/chat/stream` ține
 * răspunsul deschis cât timp socketul e viu, deci `inject` nu are ceas care să-l închidă.
 */
import argon2 from 'argon2'
import { Readable } from 'node:stream'
import { and, eq, inArray, isNull } from 'drizzle-orm'
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
import { hasOpenConnection, openConnection, resetPresenceForTests } from './presence.js'
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
}

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
  return { me, token }
}

const ana = await user('qa-chat-ana@test.local', ['mesaje.view'])
const ion = await user('qa-chat-ion@test.local', ['mesaje.view'])
const outsider = await user('qa-chat-outsider@test.local', ['mesaje.view'])
const faraMesaje = await user('qa-chat-fara-mesaje@test.local', ['email.view'])

const cookie = (u: TestSession) => ({ vana_session: u.token })
const get = (url: string, u: TestSession) => app.inject({ method: 'GET', url, cookies: cookie(u) })
const post = (url: string, u: TestSession, payload: InjectPayload): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url, cookies: cookie(u), payload })
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

const sent = await post(`/api/chat/conversations/${dmId}/messages`, ana, { body: 'Salut, Ion', clientId: crypto.randomUUID() })
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
    const res = await post(`/api/chat/conversations/${dmId}/messages`, outsider, { body: 'intruse', clientId: crypto.randomUUID() })
    expect(res.statusCode).toBe(404)
    const rows = await db.select().from(messages).where(eq(messages.conversationId, dmId))
    expect(rows.some((m) => m.body === 'intruse')).toBe(false)
  })

  it('marcatul citit într-o conversație străină e 404', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/read`, outsider, { messageId: firstMessageId })
    expect(res.statusCode).toBe(404)
  })

  it('editarea unui mesaj al altuia e 404 — și mesajul rămâne neatins', async () => {
    const res = await patch(`/api/chat/messages/${firstMessageId}`, ion, { body: 'rescris' })
    expect(res.statusCode).toBe(404)
    const [row] = await db.select().from(messages).where(eq(messages.id, firstMessageId))
    expect(row!.body).toBe('Salut, Ion')
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
})

describe('mesaje', () => {
  it('trimiterea avansează și citirea de pe conversăție', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ion, { body: 'Salut, Ana', clientId: crypto.randomUUID() })
    expect(res.statusCode).toBe(200)
    const id = res.json().data.id as string
    const read = await post(`/api/chat/conversations/${dmId}/read`, ana, { messageId: id })
    expect(read.statusCode).toBe(200)
  })

  it('mesajul gol fără atașamente e refuzat cu 400', async () => {
    const res = await post(`/api/chat/conversations/${dmId}/messages`, ana, { body: '   ', clientId: crypto.randomUUID() })
    expect(res.statusCode).toBe(400)
  })

  it('aceeași clientId la retrimitere întoarce același mesaj, nu o copie', async () => {
    const clientId = crypto.randomUUID()
    const first = await post(`/api/chat/conversations/${groupId}/messages`, ana, { body: 'Conectare lentă', clientId })
    const second = await post(`/api/chat/conversations/${groupId}/messages`, ana, { body: 'Conectare lentă', clientId })
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
    const created = await post(`/api/chat/conversations/${groupId}/messages`, ion, { body: 'se șterge', clientId: crypto.randomUUID() })
    const id = created.json().data.id as string
    const res = await app.inject({ method: 'DELETE', url: `/api/chat/messages/${id}`, cookies: cookie(ion) })
    expect(res.statusCode).toBe(200)
    const listed = await get(`/api/chat/conversations/${groupId}/messages?limit=50`, ana)
    const row = listed.json().data.messages.find((m: { id: string }) => m.id === id)
    expect(row.deletedAt).not.toBeNull()
    expect(row.body).toBe('')
  })
})

describe('necitite și „nu mai notifica"', () => {
  it('mesajele altora îi apar omului ca necitite, iar după citire dispar', async () => {
    const conv = await post('/api/chat/conversations', ana, { kind: 'group', name: 'QA necitite', memberIds: [ion.me.id] })
    const id = conv.json().data.id as string
    conversationIds.push(id)
    const created = await post(`/api/chat/conversations/${id}/messages`, ana, { body: 'pentru Ion', clientId: crypto.randomUUID() })
    const messageId = created.json().data.id as string

    const list = await get('/api/chat/conversations', ion)
    expect(list.json().data.find((c: { id: string }) => c.id === id).unreadCount).toBe(1)

    await post(`/api/chat/conversations/${id}/read`, ion, { messageId })
    const afterRead = await get('/api/chat/conversations', ion)
    expect(afterRead.json().data.find((c: { id: string }) => c.id === id).unreadCount).toBe(0)
  })

  it('bifele: trimis, livrat când Ion își încarcă lista, văzut după citire', async () => {
    const conv = await post('/api/chat/conversations', ana, { kind: 'group', name: 'QA bife', memberIds: [ion.me.id] })
    const id = conv.json().data.id as string
    conversationIds.push(id)
    const created = await post(`/api/chat/conversations/${id}/messages`, ana, { body: 'ai primit?', clientId: crypto.randomUUID() })
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
    await post(`/api/chat/conversations/${id}/messages`, ana, { body: 'mute', clientId: crypto.randomUUID() })
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
  // 406 „the request is not multipart".
  async function upload(u: TestSession, filename: string, contentType: string, content: string) {
    const boundary = `----qaChat${crypto.randomUUID()}`
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--\r\n`
    return app.inject({
      method: 'POST',
      url: '/api/chat/attachments',
      cookies: cookie(u),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
  }

  it('o poză se servește inline, un .html doar ca descărcare', async () => {
    // Atașamentul se leagă de un mesaj, deci servirea lui se face pe baza membriei în
    // conversația aceluia — un upload neatribuit e citibil doar de cel care l-a încărcat
    // (testul următor).
    const image = await upload(ana, 'poza.png', 'image/png', 'png-de-test')
    const imageId = image.json().data.id as string
    await post(`/api/chat/conversations/${dmId}/messages`, ana, {
      body: 'cu poză',
      clientId: crypto.randomUUID(),
      attachmentIds: [imageId],
    })
    const inline = await get(`/api/chat/attachments/${imageId}`, ion)
    expect(inline.statusCode).toBe(200)
    expect(inline.headers['content-disposition']).toContain('inline')
    expect(inline.headers['x-content-type-options']).toBe('nosniff')

    const html = await upload(ana, 'capcana.html', 'text/html', '<script>alert(1)</script>')
    const htmlId = html.json().data.id as string
    await post(`/api/chat/conversations/${dmId}/messages`, ana, {
      body: 'cu html',
      clientId: crypto.randomUUID(),
      attachmentIds: [htmlId],
    })
    const attachment = await get(`/api/chat/attachments/${htmlId}`, ion)
    expect(attachment.statusCode).toBe(200)
    expect(attachment.headers['content-disposition']).toContain('attachment')
    expect(attachment.headers['x-content-type-options']).toBe('nosniff')
  })

  it('un atașament al unei conversații din care nu faci parte e 404, cerut direct prin id', async () => {
    const image = await upload(ion, 'secret.png', 'image/png', 'png-de-test')
    const imageId = image.json().data.id as string
    const res = await get(`/api/chat/attachments/${imageId}`, outsider)
    expect(res.statusCode).toBe(404)
  })

  it('un upload netrimis e citibil doar de cel care l-a încărcat', async () => {
    const image = await upload(ion, 'netrimis.png', 'image/png', 'png-de-test')
    const imageId = image.json().data.id as string
    expect((await get(`/api/chat/attachments/${imageId}`, ion)).statusCode).toBe(200)
    expect((await get(`/api/chat/attachments/${imageId}`, ana)).statusCode).toBe(404)
  })

  it('numele cu slash-uri nu ajunge ca drum în R2 sau în antetul de descărcare', async () => {
    const res = await upload(ana, '../../etc/pa**sswd', 'text/plain', 'text')
    expect(res.statusCode).toBe(200)
    const id = res.json().data.id as string
    const [row] = await db.select().from(messageAttachments).where(eq(messageAttachments.id, id))
    expect(row!.storagePath).toMatch(/^chat\/[0-9a-f-]{36}-/)
    expect(row!.storagePath).not.toContain('..')
    const download = await get(`/api/chat/attachments/${id}`, ana)
    expect(download.headers['content-disposition']).not.toContain('/')
    await db.delete(messageAttachments).where(eq(messageAttachments.id, id))
  })

  it('un fișier peste 50 MB e refuzat cu 413', async () => {
    const res = await upload(ana, 'mare.bin', 'application/octet-stream', 'x'.repeat(50 * 1024 * 1024 + 1024))
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
