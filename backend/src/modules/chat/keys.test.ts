/**
 * Device keys and the key transport behind end-to-end encrypted messages (PLAN.md part M): who may
 * publish keys for whom, the identity signature, one-time key claims, the to-device queue, the
 * key backup, and the re-encryption of old clear-text messages. The server never gets a private
 * key or a plaintext; the last test checks that nothing readable lands in the chat tables.
 */
import argon2 from 'argon2'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { conversationMembers, conversations, messages, roles, userSessions, users } from '../../shared/db/schema/index.js'
import { deviceSignaturePayload, registerDevice as registerDeviceDirect } from './keys.js'
import { purgeLegacyPlaintext } from './service.js'
import { sessionToken } from '../../shared/testing/session-token.js'

type InjectPayload = NonNullable<InjectOptions['payload']>

// What a notification would carry; nothing leaves for a real push service.
const pushes = vi.hoisted(() => [] as { title: string; body: string }[])
vi.mock('../../shared/lib/push.js', async (original) => ({
  ...(await original<typeof import('../../shared/lib/push.js')>()),
  notifyPush: vi.fn(async (_kind: string, build: (locale: string) => { title: string; body: string }) => {
    pushes.push(build('ro'))
  }),
}))

const app = await buildServer()
await app.ready()

const userIds: string[] = []
const roleIds: string[] = []
const conversationIds: string[] = []

interface TestPerson {
  id: string
  token: string
}

// Leftovers of a run that died before afterAll: same emails and role names would collide.
const staleUsers = await db.select({ id: users.id }).from(users).where(like(users.email, 'qa-keys-%@test.local'))
if (staleUsers.length) {
  const staleIds = staleUsers.map((row) => row.id)
  const staleMemberships = await db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(inArray(conversationMembers.userId, staleIds))
  const staleCreated = await db.select({ id: conversations.id }).from(conversations).where(inArray(conversations.createdByUserId, staleIds))
  const staleConversationIds = [...new Set([...staleMemberships, ...staleCreated].map((row) => row.id))]
  if (staleConversationIds.length) {
    await db.delete(conversationMembers).where(inArray(conversationMembers.conversationId, staleConversationIds))
    await db.delete(messages).where(inArray(messages.conversationId, staleConversationIds))
    await db.delete(conversations).where(inArray(conversations.id, staleConversationIds))
  }
  await db.delete(users).where(inArray(users.id, staleIds))
}
await db.delete(roles).where(like(roles.name, 'Test: keys qa-keys-%'))

async function person(label: string, features = ['mesaje.view']): Promise<TestPerson> {
  const email = `qa-keys-${label}@test.local`
  const [role] = await db.insert(roles).values({ name: `Test: keys ${email}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await argon2.hash('parola-de-test-123'), displayName: label, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, token: await sessionToken(app, row!.id) }
}

const ana = await person('ana')
const ion = await person('ion')
const maria = await person('maria')
const tokenOwner = await person('token-owner', ['mesaje.view', 'echipa.tokenuri'])

afterAll(async () => {
  for (const id of conversationIds) {
    await db.delete(conversationMembers).where(eq(conversationMembers.conversationId, id))
    await db.delete(messages).where(eq(messages.conversationId, id))
    await db.delete(conversations).where(eq(conversations.id, id))
  }
  await db.delete(users).where(inArray(users.id, userIds))
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

const cookie = (p: TestPerson) => ({ vana_session: p.token })
const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, p: TestPerson, payload?: InjectPayload): Promise<LightMyRequestResponse> =>
  app.inject({ method, url, cookies: cookie(p), payload })

// 32 random bytes, unpadded: the shape of a vodozemac public key. The server never uses it.
const key = () => randomBytes(32).toString('base64').replace(/=+$/, '')
const b64 = (text: string) => Buffer.from(text).toString('base64')

interface TestDevice {
  id: string
  publicIdentityKey: string
  signingKey: string
}

async function device(p: TestPerson, oneTimeKeys: string[] = []): Promise<TestDevice> {
  const publicIdentityKey = key()
  const signingKey = key()
  const res = await call('POST', '/api/chat/keys/devices', p, {
    publicIdentityKey,
    signingKey,
    label: 'QA',
    oneTimeKeys: oneTimeKeys.map((keyId) => ({ keyId, publicKey: key() })),
    fallbackKey: { keyId: 'fallback-1', publicKey: key() },
  })
  expect(res.statusCode).toBe(201)
  return { id: res.json().data.id as string, publicIdentityKey, signingKey }
}

// A real Ed25519 master key, as the browser would make: the server verifies signatures with it.
function masterKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const masterKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  return { masterKey, signDevice: (d: TestDevice) => sign(null, Buffer.from(deviceSignaturePayload(d)), privateKey).toString('base64') }
}

function identityBody(master: ReturnType<typeof masterKeyPair>, d: TestDevice, reset?: boolean) {
  return {
    masterKey: master.masterKey,
    recoveryCheck: randomBytes(24).toString('base64'),
    secretBundle: randomBytes(48).toString('base64'),
    deviceId: d.id,
    deviceSignature: master.signDevice(d),
    ...(reset ? { reset } : {}),
  }
}

async function myKeys(p: TestPerson, deviceId?: string) {
  const res = await call('GET', `/api/chat/keys/me${deviceId ? `?deviceId=${deviceId}` : ''}`, p)
  expect(res.statusCode).toBe(200)
  return res.json().data as {
    identity: { masterKey: string; version: number } | null
    devices: { id: string; masterSignature: string | null }[]
    oneTimeKeys: number | null
  }
}

describe('înregistrarea dispozitivelor', () => {
  it('înregistrarea întoarce 201 și e idempotentă pe aceeași cheie de identitate', async () => {
    const first = await device(ana, ['k1', 'k2'])
    const again = await call('POST', '/api/chat/keys/devices', ana, {
      publicIdentityKey: first.publicIdentityKey,
      signingKey: first.signingKey,
      label: 'QA',
    })
    expect(again.statusCode).toBe(201)
    expect(again.json().data.id).toBe(first.id)
    const mine = await myKeys(ana, first.id)
    expect(mine.devices.filter((d) => d.id === first.id)).toHaveLength(1)
    expect(mine.oneTimeKeys).toBe(2)
  })

  it('aceeași cheie de la alt om e 409 IDENTITY_EXISTS', async () => {
    const mine = await device(ana)
    const res = await call('POST', '/api/chat/keys/devices', ion, {
      publicIdentityKey: mine.publicIdentityKey,
      signingKey: key(),
      label: 'QA',
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('IDENTITY_EXISTS')
  })

  it('un dispozitiv revocat nu revine prin aceeași cheie', async () => {
    const gone = await device(ion)
    expect((await call('DELETE', `/api/chat/keys/devices/${gone.id}`, ion)).statusCode).toBe(200)
    const res = await call('POST', '/api/chat/keys/devices', ion, { publicIdentityKey: gone.publicIdentityKey, signingKey: gone.signingKey })
    expect(res.statusCode).toBe(409)
    expect((await myKeys(ion)).devices.some((d) => d.id === gone.id)).toBe(false)
  })

  it('revocarea dispozitivului altcuiva e 404 și dispozitivul rămâne', async () => {
    const hers = await device(ana)
    expect((await call('DELETE', `/api/chat/keys/devices/${hers.id}`, ion)).statusCode).toBe(404)
    expect((await myKeys(ana)).devices.some((d) => d.id === hers.id)).toBe(true)
  })

  it('un dispozitiv al cărui login a fost revocat dispare din lista colegilor', async () => {
    const owner = await person('session-owner')
    const familyAlive = crypto.randomUUID()
    const familyDead = crypto.randomUUID()
    const session = (familyId: string, revokedAt: Date | null) => ({
      userId: owner.id,
      familyId,
      tokenHash: randomBytes(16).toString('hex'),
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt,
    })
    await db.insert(userSessions).values([session(familyAlive, null), session(familyDead, new Date())])
    const alive = await registerDeviceDirect(owner.id, familyAlive, { publicIdentityKey: key(), signingKey: key(), label: '', oneTimeKeys: [] })
    const dead = await registerDeviceDirect(owner.id, familyDead, { publicIdentityKey: key(), signingKey: key(), label: '', oneTimeKeys: [] })

    const res = await call('GET', `/api/chat/keys/devices?userIds=${owner.id}`, ion)
    expect(res.statusCode).toBe(200)
    const listed = (res.json().data as { userId: string; devices: { id: string }[] }[]).find((p) => p.userId === owner.id)
    expect(listed!.devices.map((d) => d.id)).toEqual([alive.id])
    expect(listed!.devices.some((d) => d.id === dead.id)).toBe(false)
  })

  it('un token API personal e refuzat cu 403 pe rutele de chei', async () => {
    const minted = await call('POST', '/api/me/api-tokens', tokenOwner, { name: 'qa-keys', features: ['mesaje.view'] })
    expect(minted.statusCode).toBe(201)
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/keys/me',
      headers: { authorization: `Bearer ${minted.json().data.token as string}` },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('CHAT_KEYS_NEED_SESSION')
  })
})

describe('identitatea omului', () => {
  it('PUT identity cu semnătură Ed25519 reală semnează dispozitivul', async () => {
    const owner = await person('identity-ok')
    const d = await device(owner)
    const master = masterKeyPair()
    const body = identityBody(master, d)
    expect((await call('PUT', '/api/chat/keys/identity', owner, body)).statusCode).toBe(200)
    const mine = await myKeys(owner, d.id)
    expect(mine.identity).toMatchObject({ masterKey: master.masterKey, version: 1 })
    expect(mine.devices.find((x) => x.id === d.id)!.masterSignature).toBe(body.deviceSignature)
  })

  it('semnătura greșită e 409 BAD_SIGNATURE și nu creează identitate', async () => {
    const owner = await person('identity-bad')
    const d = await device(owner)
    const other = await device(owner)
    const master = masterKeyPair()
    const wrongDevice = { ...identityBody(master, d), deviceSignature: master.signDevice(other) }
    const res = await call('PUT', '/api/chat/keys/identity', owner, wrongDevice)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('BAD_SIGNATURE')
    const signedByStranger = { ...identityBody(master, d), deviceSignature: masterKeyPair().signDevice(d) }
    expect((await call('PUT', '/api/chat/keys/identity', owner, signedByStranger)).json().error.code).toBe('BAD_SIGNATURE')
    expect((await myKeys(owner)).identity).toBeNull()
  })

  it('a doua identitate fără reset e 409 IDENTITY_EXISTS', async () => {
    const owner = await person('identity-twice')
    const d = await device(owner)
    expect((await call('PUT', '/api/chat/keys/identity', owner, identityBody(masterKeyPair(), d))).statusCode).toBe(200)
    const second = masterKeyPair()
    const res = await call('PUT', '/api/chat/keys/identity', owner, identityBody(second, d))
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('IDENTITY_EXISTS')
    expect((await myKeys(owner)).identity!.masterKey).not.toBe(second.masterKey)
  })

  it('reset: versiunea crește, backup-ul se golește, celelalte dispozitive pierd semnătura', async () => {
    const owner = await person('identity-reset')
    const first = await device(owner)
    const second = await device(owner)
    const oldMaster = masterKeyPair()
    expect((await call('PUT', '/api/chat/keys/identity', owner, identityBody(oldMaster, first))).statusCode).toBe(200)
    const approve = await call('POST', `/api/chat/keys/devices/${second.id}/signature`, owner, { signature: oldMaster.signDevice(second) })
    expect(approve.statusCode).toBe(200)
    await call('PUT', '/api/chat/keys/backup', owner, { sessions: [{ sessionId: key(), firstIndex: 0, data: b64('opaque-export') }] })
    expect((await call('GET', '/api/chat/keys/backup', owner)).json().data).toHaveLength(1)
    const before = await myKeys(owner)
    expect(before.devices.every((d) => d.masterSignature !== null)).toBe(true)

    const newMaster = masterKeyPair()
    const reset = await call('PUT', '/api/chat/keys/identity', owner, identityBody(newMaster, second, true))
    expect(reset.statusCode).toBe(200)
    const after = await myKeys(owner)
    expect(after.identity).toMatchObject({ masterKey: newMaster.masterKey, version: 2 })
    expect(after.devices.find((d) => d.id === first.id)!.masterSignature).toBeNull()
    expect(after.devices.find((d) => d.id === second.id)!.masterSignature).not.toBeNull()
    expect((await call('GET', '/api/chat/keys/backup', owner)).json().data).toEqual([])
  })

  it('semnarea unui dispozitiv fără identitate e 409 NO_IDENTITY, iar pe al altcuiva 404', async () => {
    const owner = await person('signature')
    const mine = await device(owner)
    const noIdentity = await call('POST', `/api/chat/keys/devices/${mine.id}/signature`, owner, { signature: randomBytes(64).toString('base64') })
    expect(noIdentity.statusCode).toBe(409)
    expect(noIdentity.json().error.code).toBe('NO_IDENTITY')

    const hers = await device(ana)
    const master = masterKeyPair()
    await call('PUT', '/api/chat/keys/identity', owner, identityBody(master, mine))
    const res = await call('POST', `/api/chat/keys/devices/${hers.id}/signature`, owner, { signature: master.signDevice(hers) })
    expect(res.statusCode).toBe(404)
    expect((await myKeys(ana)).devices.find((d) => d.id === hers.id)!.masterSignature).toBeNull()
  })
})

describe('claim', () => {
  const claim = async (p: TestPerson, deviceIds: string[]) => {
    const res = await call('POST', '/api/chat/keys/claim', p, { deviceIds })
    expect(res.statusCode).toBe(200)
    return res.json().data as { deviceId: string; keyId: string; publicKey: string }[]
  }

  it('o cheie unică se dă o singură dată, apoi cea de rezervă, de mai multe ori', async () => {
    const d = await device(ana, ['otk-1', 'otk-2'])
    const first = await claim(ion, [d.id])
    const second = await claim(maria, [d.id])
    expect([first[0]!.keyId, second[0]!.keyId]).toEqual(['otk-1', 'otk-2'])
    expect((await myKeys(ana, d.id)).oneTimeKeys).toBe(0)

    const third = await claim(ion, [d.id])
    const fourth = await claim(maria, [d.id])
    expect(third[0]!.keyId).toBe('fallback-1')
    expect(fourth[0]).toEqual(third[0])
  })

  it('un dispozitiv revocat nu mai dă nicio cheie', async () => {
    const d = await device(ana, ['otk-1'])
    await call('DELETE', `/api/chat/keys/devices/${d.id}`, ana)
    expect(await claim(ion, [d.id])).toEqual([])
  })
})

describe('mesaje către dispozitive', () => {
  it('trimis de A la dispozitivul lui B, doar B îl vede, iar după ack coada e goală', async () => {
    const from = await device(ana)
    const to = await device(ion)
    const sent = await call('POST', '/api/chat/keys/to-device', ana, {
      senderDeviceId: from.id,
      messages: [{ deviceId: to.id, messageType: 0, ciphertext: b64('opaque-olm') }],
    })
    expect(sent.statusCode).toBe(200)

    const queue = await call('GET', `/api/chat/keys/to-device?deviceId=${to.id}`, ion)
    expect(queue.statusCode).toBe(200)
    const items = queue.json().data as { id: number; senderUserId: string; senderIdentityKey: string; senderDeviceId: string; ciphertext: string }[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      senderUserId: ana.id,
      senderIdentityKey: from.publicIdentityKey,
      senderDeviceId: from.id,
      ciphertext: b64('opaque-olm'),
    })

    expect((await call('GET', `/api/chat/keys/to-device?deviceId=${to.id}`, maria)).statusCode).toBe(404)
    expect((await call('POST', '/api/chat/keys/to-device/ack', maria, { deviceId: to.id, upToId: items[0]!.id })).statusCode).toBe(404)

    expect((await call('POST', '/api/chat/keys/to-device/ack', ion, { deviceId: to.id, upToId: items[0]!.id })).statusCode).toBe(200)
    const after = await call('GET', `/api/chat/keys/to-device?deviceId=${to.id}`, ion)
    expect(after.json().data).toEqual([])
  })

  it('A nu poate trimite cu dispozitivul lui B', async () => {
    const hers = await device(ion)
    const target = await device(maria)
    const res = await call('POST', '/api/chat/keys/to-device', ana, {
      senderDeviceId: hers.id,
      messages: [{ deviceId: target.id, messageType: 1, ciphertext: b64('forged') }],
    })
    expect(res.statusCode).toBe(404)
    expect((await call('GET', `/api/chat/keys/to-device?deviceId=${target.id}`, maria)).json().data).toEqual([])
  })

  it('revocarea dispozitivului îi golește coada', async () => {
    const from = await device(ana)
    const to = await device(ion)
    await call('POST', '/api/chat/keys/to-device', ana, {
      senderDeviceId: from.id,
      messages: [{ deviceId: to.id, messageType: 0, ciphertext: b64('opaque-olm') }],
    })
    await call('DELETE', `/api/chat/keys/devices/${to.id}`, ion)
    const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from to_device_messages where recipient_device_id = ${to.id}`)
    expect(rows[0]!.n).toBe(0)
  })
})

describe('backup-ul cheilor de sesiune', () => {
  const session = (sessionId: string, firstIndex: number, data: string) => ({ sessionId, firstIndex, data: b64(data) })
  const read = async (p: TestPerson, query = '') =>
    (await call('GET', `/api/chat/keys/backup${query}`, p)).json().data as { id: number; sessionId: string; firstIndex: number; data: string }[]

  it('PUT apoi GET, paginat cu after', async () => {
    const owner = await person('backup-page')
    const ids = [key(), key(), key()]
    const put = await call('PUT', '/api/chat/keys/backup', owner, { sessions: ids.map((id, i) => session(id, i, `export-${i}`)) })
    expect(put.statusCode).toBe(200)
    const firstPage = await read(owner, '?limit=2')
    expect(firstPage.map((s) => s.sessionId)).toEqual([ids[0], ids[1]])
    const rest = await read(owner, `?after=${firstPage[1]!.id}&limit=2`)
    expect(rest.map((s) => s.sessionId)).toEqual([ids[2]])
    expect(rest[0]!.data).toBe(b64('export-2'))
  })

  it('un export cu firstIndex mai mic îl înlocuiește pe unul mai mare, nu și invers', async () => {
    const owner = await person('backup-index')
    const sessionId = key()
    await call('PUT', '/api/chat/keys/backup', owner, { sessions: [session(sessionId, 5, 'from-5')] })
    await call('PUT', '/api/chat/keys/backup', owner, { sessions: [session(sessionId, 2, 'from-2')] })
    let [row] = await read(owner)
    expect(row).toMatchObject({ firstIndex: 2, data: b64('from-2') })

    await call('PUT', '/api/chat/keys/backup', owner, { sessions: [session(sessionId, 9, 'from-9')] })
    ;[row] = await read(owner)
    expect(row).toMatchObject({ firstIndex: 2, data: b64('from-2') })
    expect(await read(owner)).toHaveLength(1)
  })

  it('backup-ul unui om nu se vede de altul', async () => {
    const owner = await person('backup-private')
    await call('PUT', '/api/chat/keys/backup', owner, { sessions: [session(key(), 0, 'mine')] })
    expect(await read(ion)).not.toContainEqual(expect.objectContaining({ data: b64('mine') }))
  })
})

describe('recriptarea mesajelor vechi', () => {
  async function conversationWith(creator: TestPerson, memberId: string): Promise<string> {
    const res = await call('POST', '/api/chat/conversations', creator, { kind: 'dm', userId: memberId })
    const id = res.json().data.id as string
    conversationIds.push(id)
    return id
  }

  const legacyMessage = async (conversationId: string, authorId: string, body = 'legacy clear text') => {
    const [row] = await db.insert(messages).values({ conversationId, authorUserId: authorId, body, clientId: crypto.randomUUID() }).returning()
    return row!
  }
  const encrypted = (d: TestDevice) => ({ v: 1, ciphertext: b64(`opaque-${randomBytes(4).toString('hex')}`), senderDeviceId: d.id })
  const encryptCall = (p: TestPerson, messageId: string, payload: InjectPayload) => call('POST', `/api/chat/messages/${messageId}/encrypt`, p, payload)
  const stored = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0]!

  it('autorul își recriptează mesajul: body rămâne în DB o săptămână, dar API-ul întoarce gol', async () => {
    const author = await person('legacy-author')
    const reader = await person('legacy-reader')
    const authorDevice = await device(author)
    const conversationId = await conversationWith(author, reader.id)
    const message = await legacyMessage(conversationId, author.id)
    const content = encrypted(authorDevice)

    const res = await encryptCall(author, message.id, { encrypted: content })
    expect(res.statusCode).toBe(200)
    const row = await stored(message.id)
    expect(row.legacyEncryptedAt).not.toBeNull()
    expect(row.body).toBe('legacy clear text')
    expect(row.encVersion).toBe(1)

    const listed = (await call('GET', `/api/chat/conversations/${conversationId}/messages`, reader)).json().data.messages
    expect(listed.find((m: { id: string }) => m.id === message.id)).toMatchObject({ body: '', encrypted: content })

    const again = await encryptCall(author, message.id, { encrypted: encrypted(authorDevice) })
    expect(again.statusCode).toBe(400)
    expect(again.json().error.code).toBe('ALREADY_ENCRYPTED')
  })

  it('un alt membru o poate face doar dacă autorul nu are niciun dispozitiv semnat', async () => {
    const author = await person('legacy-unsigned')
    const colleague = await person('legacy-colleague')
    await device(author)
    const colleagueDevice = await device(colleague)
    const conversationId = await conversationWith(author, colleague.id)
    const message = await legacyMessage(conversationId, author.id)

    const res = await encryptCall(colleague, message.id, { encrypted: encrypted(colleagueDevice) })
    expect(res.statusCode).toBe(200)
    expect((await stored(message.id)).legacyEncryptedAt).not.toBeNull()
  })

  it('dacă autorul are un dispozitiv semnat, altul primește 400 NOT_THE_AUTHOR și mesajul rămâne neatins', async () => {
    const author = await person('legacy-signed')
    const colleague = await person('legacy-other')
    const authorDevice = await device(author)
    const colleagueDevice = await device(colleague)
    expect((await call('PUT', '/api/chat/keys/identity', author, identityBody(masterKeyPair(), authorDevice))).statusCode).toBe(200)
    const conversationId = await conversationWith(author, colleague.id)
    const message = await legacyMessage(conversationId, author.id)

    const res = await encryptCall(colleague, message.id, { encrypted: encrypted(colleagueDevice) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('NOT_THE_AUTHOR')
    const row = await stored(message.id)
    expect(row).toMatchObject({ encVersion: null, legacyEncryptedAt: null, body: 'legacy clear text' })
    expect(row.ciphertext).toBeNull()
  })

  it('cineva din afara conversației primește 404, iar dispozitivul altcuiva 400 UNKNOWN_DEVICE', async () => {
    const author = await person('legacy-scope')
    const member = await person('legacy-scope-member')
    const outsider = await person('legacy-scope-outsider')
    const authorDevice = await device(author)
    const outsiderDevice = await device(outsider)
    const conversationId = await conversationWith(author, member.id)
    const message = await legacyMessage(conversationId, author.id)

    expect((await encryptCall(outsider, message.id, { encrypted: encrypted(outsiderDevice) })).statusCode).toBe(404)
    const res = await encryptCall(author, message.id, { encrypted: encrypted(outsiderDevice) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('UNKNOWN_DEVICE')
    expect((await stored(message.id)).encVersion).toBeNull()
    expect(authorDevice.id).not.toBe(outsiderDevice.id)
  })

  it('purgeLegacyPlaintext golește body doar la cele recriptate de peste 7 zile', async () => {
    const author = await person('legacy-purge')
    const reader = await person('legacy-purge-reader')
    const conversationId = await conversationWith(author, reader.id)
    const old = await legacyMessage(conversationId, author.id, 'old clear text')
    const recent = await legacyMessage(conversationId, author.id, 'recent clear text')
    const untouched = await legacyMessage(conversationId, author.id, 'never re-encrypted')
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)
    await db.update(messages).set({ legacyEncryptedAt: daysAgo(8) }).where(eq(messages.id, old.id))
    await db.update(messages).set({ legacyEncryptedAt: daysAgo(1) }).where(eq(messages.id, recent.id))

    expect(await purgeLegacyPlaintext()).toBeGreaterThanOrEqual(1)
    expect((await stored(old.id)).body).toBe('')
    expect((await stored(recent.id)).body).toBe('recent clear text')
    expect((await stored(untouched.id)).body).toBe('never re-encrypted')
  })
})

describe('serverul nu primește niciodată textul în clar (QA-M6, parțial)', () => {
  const SECRET = 'parolaSecreta42'

  it('niciun text sau bytea din tabelele de mesaje și chei nu conține textul trimis', async () => {
    const sender = await person('plain-sender')
    const reader = await person('plain-reader')
    const senderDevice = await device(sender)
    const readerDevice = await device(reader)
    const conversation = await call('POST', '/api/chat/conversations', sender, { kind: 'dm', userId: reader.id })
    const conversationId = conversation.json().data.id as string
    conversationIds.push(conversationId)

    // The browser encrypts SECRET before sending; this stand-in ciphertext is opaque by construction.
    // The test documents the guarantee: every route takes ciphertext only, and a clear body is a 400.
    const clear = await call('POST', `/api/chat/conversations/${conversationId}/messages`, sender, {
      body: SECRET,
      clientId: crypto.randomUUID(),
      encrypted: { v: 1, ciphertext: b64('opaque-1'), senderDeviceId: senderDevice.id },
    })
    expect(clear.statusCode).toBe(400)
    const sent = await call('POST', `/api/chat/conversations/${conversationId}/messages`, sender, {
      body: '',
      clientId: crypto.randomUUID(),
      encrypted: { v: 1, ciphertext: b64('opaque-2'), senderDeviceId: senderDevice.id },
    })
    expect(sent.statusCode).toBe(200)
    // The reader has no stream open, so they get a push: it says who wrote, never what.
    await vi.waitFor(() => expect(pushes.length).toBeGreaterThan(0))
    expect(JSON.stringify(pushes)).not.toContain('opaque')
    expect(pushes.at(-1)!.body).toBe('Mesaj nou')
    await call('POST', '/api/chat/keys/to-device', sender, {
      senderDeviceId: senderDevice.id,
      messages: [{ deviceId: readerDevice.id, messageType: 0, ciphertext: b64('opaque-olm') }],
    })
    await call('PUT', '/api/chat/keys/backup', sender, { sessions: [{ sessionId: key(), firstIndex: 0, data: b64('opaque-export') }] })

    const tables = ['messages', 'message_attachments', 'to_device_messages', 'key_backup_sessions']
    const columns = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name in (${sql.join(tables.map((t) => sql`${t}`), sql`, `)})
        and data_type in ('text', 'character varying', 'bytea')`)
    expect(columns.some((c) => c.table_name === 'to_device_messages')).toBe(true)
    expect(columns.some((c) => c.table_name === 'messages' && c.data_type === 'bytea')).toBe(true)

    for (const column of columns) {
      const table = sql.identifier(column.table_name)
      const name = sql.identifier(column.column_name)
      const hits =
        column.data_type === 'bytea'
          ? await db.execute<{ n: number }>(sql`select count(*)::int as n from ${table} where position(convert_to(${SECRET}, 'UTF8') in ${name}) > 0`)
          : await db.execute<{ n: number }>(sql`select count(*)::int as n from ${table} where ${name} ilike ${`%${SECRET}%`}`)
      expect(hits[0]!.n, `${column.table_name}.${column.column_name}`).toBe(0)
    }
    // Only the encrypted message was stored; the clear-body attempt left nothing behind.
    const rows = await db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.authorUserId, sender.id)))
    expect(rows).toHaveLength(1)
  })
})
