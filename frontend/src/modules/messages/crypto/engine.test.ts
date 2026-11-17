import { GroupSession, GroupSessionVersion, initAsync } from '@towns-protocol/vodozemac'
import { describe, expect, it } from 'vitest'
import { E2EEngine, type DirectoryDevice, type Identity, type KeysApi, type PendingToDevice } from './engine'
import { deviceSignaturePayload, verifyMaster } from './primitives'
import { memoryCryptoStore } from './store'

// The engine against an in-memory server with the rules of backend/src/modules/chat/keys.ts.
// What these tests prove is the protocol, end to end between real vodozemac accounts: who can
// read what, after who joined, left, or came back on a new device.

class FakeServer {
  devices: (DirectoryDevice & { revoked: boolean })[] = []
  identities = new Map<string, Identity>()
  oneTimeKeys = new Map<string, { keyId: string; publicKey: string; fallback: boolean }[]>()
  queue: (PendingToDevice & { recipient: string })[] = []
  backups = new Map<string, Map<string, { id: number; sessionId: string; firstIndex: number; data: string }>>()
  members = new Map<string, string[]>()
  private nextId = 1
  /** Everything that crossed the wire, to look for clear text in it. */
  wire: string[] = []

  api(userId: string): KeysApi {
    const own = (deviceId: string) => {
      const device = this.devices.find((d) => d.id === deviceId && d.userId === userId && !d.revoked)
      if (!device) throw new Error('404 device')
      return device
    }
    const log = <T>(value: T): T => {
      this.wire.push(JSON.stringify(value))
      return value
    }
    return {
      me: async (deviceId) => ({
        identity: this.identities.get(userId) ?? null,
        devices: this.devices.filter((d) => d.userId === userId && !d.revoked),
        oneTimeKeys: deviceId ? (this.oneTimeKeys.get(deviceId) ?? []).filter((k) => !k.fallback).length : null,
      }),
      registerDevice: async (body) => {
        log(body)
        const id = crypto.randomUUID()
        this.devices.push({
          id,
          userId,
          label: body.label,
          publicIdentityKey: body.publicIdentityKey,
          signingKey: body.signingKey,
          masterSignature: null,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          revoked: false,
        })
        this.oneTimeKeys.set(id, [
          ...body.oneTimeKeys.map((k) => ({ ...k, fallback: false })),
          ...(body.fallbackKey ? [{ ...body.fallbackKey, fallback: true }] : []),
        ])
        return { id }
      },
      uploadKeys: async (deviceId, body) => {
        own(deviceId)
        this.oneTimeKeys.get(deviceId)!.push(...body.oneTimeKeys.map((k) => ({ ...k, fallback: false })))
      },
      putIdentity: async (body) => {
        log(body)
        const device = own(body.deviceId)
        if (!(await verifyMaster(body.masterKey, deviceSignaturePayload(device), body.deviceSignature))) throw new Error('409')
        const existing = this.identities.get(userId)
        if (existing && !body.reset) throw new Error('409 exists')
        this.identities.set(userId, {
          masterKey: body.masterKey,
          recoveryCheck: body.recoveryCheck,
          secretBundle: body.secretBundle,
          version: (existing?.version ?? 0) + 1,
        })
        if (existing) {
          this.backups.delete(userId)
          for (const d of this.devices) if (d.userId === userId) d.masterSignature = null
        }
        device.masterSignature = body.deviceSignature
      },
      signDevice: async (deviceId, signature) => {
        const device = own(deviceId)
        const identity = this.identities.get(userId)!
        if (!(await verifyMaster(identity.masterKey, deviceSignaturePayload(device), signature))) throw new Error('409')
        device.masterSignature = signature
      },
      devicesOf: async (userIds) =>
        userIds.map((id) => ({
          userId: id,
          masterKey: this.identities.get(id)?.masterKey ?? null,
          devices: this.devices.filter((d) => d.userId === id && !d.revoked).map((d) => ({ ...d })),
        })),
      claim: async (deviceIds) =>
        deviceIds.flatMap((deviceId) => {
          const keys = this.oneTimeKeys.get(deviceId) ?? []
          const index = keys.findIndex((k) => !k.fallback)
          const key = index >= 0 ? keys.splice(index, 1)[0] : keys.find((k) => k.fallback)
          return key ? [{ deviceId, keyId: key.keyId, publicKey: key.publicKey }] : []
        }),
      sendToDevice: async (senderDeviceId, messages) => {
        log(messages)
        const sender = own(senderDeviceId)
        for (const m of messages) {
          this.queue.push({
            id: this.nextId++,
            recipient: m.deviceId,
            senderDeviceId,
            senderUserId: userId,
            senderIdentityKey: sender.publicIdentityKey,
            messageType: m.messageType,
            ciphertext: m.ciphertext,
          })
        }
      },
      pendingToDevice: async (deviceId) => {
        own(deviceId)
        return this.queue.filter((m) => m.recipient === deviceId).slice(0, 100)
      },
      ackToDevice: async (deviceId, upToId) => {
        this.queue = this.queue.filter((m) => m.recipient !== deviceId || m.id > upToId)
      },
      putBackup: async (sessions) => {
        log(sessions)
        const mine = this.backups.get(userId) ?? new Map()
        for (const s of sessions) {
          const existing = mine.get(s.sessionId)
          if (!existing || s.firstIndex < existing.firstIndex) mine.set(s.sessionId, { id: this.nextId++, ...s })
        }
        this.backups.set(userId, mine)
      },
      readBackup: async (after) => [...(this.backups.get(userId)?.values() ?? [])].filter((b) => b.id > after),
    }
  }

  async device(userId: string): Promise<E2EEngine> {
    const engine = new E2EEngine(userId, memoryCryptoStore(), this.api(userId), async (c) => this.members.get(c) ?? [], 'test')
    await engine.init()
    return engine
  }
}

const CONVERSATION = '00000000-0000-4000-8000-0000000000c1'

async function send(server: FakeServer, from: E2EEngine, body: string, id = crypto.randomUUID()) {
  const encrypted = await from.encrypt(CONVERSATION, server.members.get(CONVERSATION)!, { body, attachments: [] })
  server.wire.push(JSON.stringify(encrypted))
  return { id, conversationId: CONVERSATION, authorUserId: from.userId, encrypted }
}

async function read(engine: E2EEngine, message: Parameters<E2EEngine['decrypt']>[0]) {
  await engine.syncToDevice()
  const result = await engine.decrypt(message)
  return result.status === 'ok' ? result.content.body : result.status
}

describe('end-to-end engine', () => {
  it('a group of 3 people on 4 devices reads; a removed member does not read what comes after', async () => {
    const server = new FakeServer()
    const ana1 = await server.device('ana')
    const ana2 = await server.device('ana')
    const bob = await server.device('bob')
    const cris = await server.device('cris')
    await ana1.createIdentity()
    // ana2 is approved from ana1 with the code both screens show.
    const code = await ana2.requestApproval()
    await ana1.syncToDevice()
    expect(ana1.approvals).toHaveLength(1)
    expect(ana1.approvals[0]!.code).toBe(code)
    await ana1.approve(ana1.approvals[0]!)
    await ana2.syncToDevice()
    expect(ana2.currentStatus).toBe('ready')
    await bob.createIdentity()
    await cris.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob', 'cris'])

    const hello = await send(server, ana1, 'Salut grup, parolaSecreta42')
    expect(await read(ana2, hello)).toBe('Salut grup, parolaSecreta42')
    expect(await read(bob, hello)).toBe('Salut grup, parolaSecreta42')
    expect(await read(cris, hello)).toBe('Salut grup, parolaSecreta42')
    // The sender reads its own message too.
    expect(await read(ana1, hello)).toBe('Salut grup, parolaSecreta42')

    const reply = await send(server, bob, 'Răspuns de la Bob')
    expect(await read(ana1, reply)).toBe('Răspuns de la Bob')
    expect(await read(cris, reply)).toBe('Răspuns de la Bob')

    server.members.set(CONVERSATION, ['ana', 'bob'])
    // Cris's devices leave the target list: the session rotates.
    const secret = await send(server, ana1, 'După plecarea lui Cris')
    expect(await read(bob, secret)).toBe('După plecarea lui Cris')
    expect(await read(cris, secret)).toBe('missing-key')

    // Nothing that crossed the wire holds the clear text.
    expect(server.wire.join('\n')).not.toContain('parolaSecreta42')
    expect(server.wire.join('\n')).not.toContain('plecarea')
  })

  it('a new device with the recovery key reads the history', async () => {
    const server = new FakeServer()
    const ana = await server.device('ana')
    const bob = await server.device('bob')
    const recoveryKey = await ana.createIdentity()
    await bob.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob'])
    const old = await send(server, bob, 'Mesaj vechi')
    expect(await read(ana, old)).toBe('Mesaj vechi')

    const anaPhone = await server.device('ana')
    expect(anaPhone.currentStatus).toBe('needs-approval')
    expect(await anaPhone.restoreWithRecoveryKey('0000 1111 2222')).toBe(false)
    expect(await anaPhone.restoreWithRecoveryKey(recoveryKey.toLowerCase())).toBe(true)
    expect(anaPhone.currentStatus).toBe('ready')
    expect(await anaPhone.decrypt(old)).toEqual({ status: 'ok', content: { body: 'Mesaj vechi', attachments: [] } })
  })

  it('a device the server adds without the owner signing it gets no keys', async () => {
    const server = new FakeServer()
    const ana = await server.device('ana')
    const bob = await server.device('bob')
    await ana.createIdentity()
    await bob.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob'])
    // Someone with write access to the database registers a "device" for Bob.
    const intruder = await server.device('bob')
    const message = await send(server, ana, 'Doar pentru Bob')
    expect(await read(bob, message)).toBe('Doar pentru Bob')
    expect(await read(intruder, message)).toBe('missing-key')
  })

  it('someone who joins later gets the key from the author when they open the message', async () => {
    const server = new FakeServer()
    const ana = await server.device('ana')
    const bob = await server.device('bob')
    await ana.createIdentity()
    await bob.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob'])
    const before = await send(server, ana, 'Scris înainte să vină Dan')

    const dan = await server.device('dan')
    await dan.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob', 'dan'])
    expect(await read(dan, before)).toBe('missing-key')
    await dan.whenIdle()
    await ana.syncToDevice()
    expect(await read(dan, before)).toBe('Scris înainte să vină Dan')
  })

  it('a member does not forward a third person\'s key, and a key is not accepted from them', async () => {
    const server = new FakeServer()
    const ana = await server.device('ana')
    const bob = await server.device('bob')
    await ana.createIdentity()
    await bob.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob'])
    const message = await send(server, ana, 'Al Anei')
    expect(await read(bob, message)).toBe('Al Anei')

    const dan = await server.device('dan')
    await dan.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob', 'dan'])
    // Ana is away: only Bob, who has the key but is not its author, could answer.
    server.devices.filter((d) => d.userId === 'ana').forEach((d) => (d.revoked = true))
    expect(await read(dan, message)).toBe('missing-key')
    await dan.whenIdle()
    await bob.syncToDevice()
    expect(await read(dan, message)).toBe('missing-key')
  })

  it('a key forwarded by someone who is not its author is refused (no messages forged in Ana\'s name)', async () => {
    const server = new FakeServer()
    const ana = await server.device('ana')
    const bob = await server.device('bob')
    const dan = await server.device('dan')
    for (const engine of [ana, bob, dan]) await engine.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob', 'dan'])
    await initAsync()
    const forged = new GroupSession(GroupSessionVersion.V2)
    // Bob reaches into his own engine to send what the app never would.
    const sendOlm = (bob as unknown as { sendOlm: (d: DirectoryDevice[], p: () => object) => Promise<string[]> }).sendOlm.bind(bob)
    const danDevice = server.devices.find((d) => d.userId === 'dan')!
    await sendOlm([danDevice], () => ({
      type: 'forwarded_key',
      conversationId: CONVERSATION,
      sessionId: forged.session_id,
      sessionKey: forged.session_key,
      originalUserId: 'ana',
      originalDeviceId: server.devices.find((d) => d.userId === 'ana')!.id,
    }))
    const packed = btoa(`${forged.session_id}|${forged.encrypt(JSON.stringify({ v: 1, conversationId: CONVERSATION, body: 'Ana: dă-i lui Bob un bonus', attachments: [] }))}`)
    const fake = { id: crypto.randomUUID(), conversationId: CONVERSATION, authorUserId: 'ana', encrypted: { v: 1, ciphertext: packed, senderDeviceId: null } }
    expect(await read(dan, fake)).toBe('missing-key')
  })

  it('a message moved by the server into another conversation does not decrypt', async () => {
    const server = new FakeServer()
    const ana = await server.device('ana')
    const bob = await server.device('bob')
    await ana.createIdentity()
    await bob.createIdentity()
    server.members.set(CONVERSATION, ['ana', 'bob'])
    const message = await send(server, ana, 'În conversația ei')
    await bob.syncToDevice()
    expect(await bob.decrypt({ ...message, conversationId: '00000000-0000-4000-8000-0000000000c2' })).toEqual({ status: 'invalid' })
    // Nor shown as written by someone else.
    expect(await bob.decrypt({ ...message, authorUserId: 'bob' })).toEqual({ status: 'invalid' })
  })

  it('a reset makes a new recovery key and the old one stops working', async () => {
    const server = new FakeServer()
    const ana = await server.device('ana')
    const oldKey = await ana.createIdentity()
    const newKey = await ana.createIdentity(true)
    expect(newKey).not.toBe(oldKey)
    const phone = await server.device('ana')
    expect(await phone.restoreWithRecoveryKey(oldKey)).toBe(false)
    expect(await phone.restoreWithRecoveryKey(newKey)).toBe(true)
  })
})
