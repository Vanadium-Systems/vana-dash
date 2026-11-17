import type * as Vodozemac from '@towns-protocol/vodozemac'
import {
  approvalCode,
  deriveFromRecoveryKey,
  deviceSignaturePayload,
  fromBase64,
  masterPublicOf,
  newMasterKey,
  newRecoveryKey,
  open,
  parseRecoveryKey,
  randomBytes,
  seal,
  signWithMaster,
  toBase64,
  unpadded,
  verifyMaster,
} from './primitives'
import type { CryptoStore } from './store'

// The end-to-end engine of Mesaje (PLAN.md part M, "Technical Design M"). One per signed-in person
// and tab. Olm (1:1 between devices) carries the Megolm keys; Megolm encrypts the messages of a
// conversation. The server is a directory and a mailbox: everything it says about keys is checked
// against the owner's master signature before a message key is sent anywhere.

type Vz = typeof Vodozemac

let vodozemac: Promise<Vz> | null = null
/** The WASM (~260 KB gzip) loads with the first conversation, not with the app. */
function loadVodozemac(): Promise<Vz> {
  vodozemac ??= import('@towns-protocol/vodozemac').then(async (module) => {
    await module.initAsync()
    return module
  })
  return vodozemac
}

// ── Wire types (backend/src/modules/chat/keys.ts) ───────────────────────────

export interface DirectoryDevice {
  id: string
  userId: string
  label: string
  publicIdentityKey: string
  signingKey: string
  masterSignature: string | null
  createdAt: string
  lastSeenAt: string
}

export interface Identity {
  masterKey: string
  recoveryCheck: string
  secretBundle: string
  version: number
}

export interface PendingToDevice {
  id: number
  senderDeviceId: string
  senderUserId: string
  senderIdentityKey: string
  messageType: number
  ciphertext: string
}

export interface KeysApi {
  me(deviceId?: string): Promise<{ identity: Identity | null; devices: DirectoryDevice[]; oneTimeKeys: number | null }>
  registerDevice(body: {
    publicIdentityKey: string
    signingKey: string
    label: string
    oneTimeKeys: { keyId: string; publicKey: string }[]
    fallbackKey?: { keyId: string; publicKey: string }
  }): Promise<{ id: string }>
  uploadKeys(deviceId: string, body: { oneTimeKeys: { keyId: string; publicKey: string }[]; fallbackKey?: { keyId: string; publicKey: string } }): Promise<void>
  putIdentity(body: {
    masterKey: string
    recoveryCheck: string
    secretBundle: string
    deviceId: string
    deviceSignature: string
    reset?: boolean
  }): Promise<void>
  signDevice(deviceId: string, signature: string): Promise<void>
  devicesOf(userIds: string[]): Promise<{ userId: string; masterKey: string | null; devices: DirectoryDevice[] }[]>
  claim(deviceIds: string[]): Promise<{ deviceId: string; keyId: string; publicKey: string }[]>
  sendToDevice(senderDeviceId: string, messages: { deviceId: string; messageType: 0 | 1; ciphertext: string }[]): Promise<void>
  pendingToDevice(deviceId: string): Promise<PendingToDevice[]>
  ackToDevice(deviceId: string, upToId: number): Promise<void>
  putBackup(sessions: { sessionId: string; firstIndex: number; data: string }[]): Promise<void>
  readBackup(after: number): Promise<{ id: number; sessionId: string; firstIndex: number; data: string }[]>
}

// ── What a message carries once decrypted ───────────────────────────────────

export interface AttachmentKey {
  id: string
  key: string
  iv: string
  sha256: string
  name: string
  type: string
  size: number
  width?: number
  height?: number
  /** The encrypted thumbnail, stored next to the file (`?size=thumb`). */
  thumb?: { key: string; iv: string; sha256: string }
}

export interface MessageContent {
  body: string
  attachments: AttachmentKey[]
}

export interface EncryptedContent {
  v: 1
  ciphertext: string
  senderDeviceId: string
}

export type DecryptResult =
  | { status: 'ok'; content: MessageContent }
  // The key has not arrived (yet): it may come over to-device or from the backup.
  | { status: 'missing-key' }
  // The key is here but the message does not belong where the server put it, or is corrupt.
  | { status: 'invalid' }

export type EngineStatus =
  | 'unsupported'
  // First device of this person: needs a recovery key made.
  | 'needs-identity'
  // The person has an identity, this device is not signed yet.
  | 'needs-approval'
  | 'ready'

export interface ApprovalRequest {
  requestId: string
  device: DirectoryDevice
  code: string
}

interface Secrets {
  masterPrivate: string
  backupKey: string
}

interface OutboundRecord {
  pickle: string
  sessionId: string
  createdAt: number
  messageCount: number
  sharedWith: string[]
}

interface InboundRecord {
  pickle: string
  sessionId: string
  conversationId: string
  senderUserId: string
  senderDeviceId: string
  firstIndex: number
  backedUp: boolean
}

export interface PlainRecord {
  messageId: string
  conversationId: string
  authorUserId: string
  createdAt?: string
  body: string
  attachments: AttachmentKey[]
}

// Olm payloads, inside the encrypted channel between two devices.
type OlmPayload =
  | { type: 'room_key'; sender: string; recipient: string; conversationId: string; sessionId: string; sessionKey: string }
  | { type: 'approval_request'; sender: string; recipient: string; requestId: string }
  | { type: 'approval_secret'; sender: string; recipient: string; requestId: string; masterPrivate: string; backupKey: string }
  | { type: 'key_request'; sender: string; recipient: string; conversationId: string; sessionId: string }
  | {
      type: 'forwarded_key'
      sender: string
      recipient: string
      conversationId: string
      sessionId: string
      sessionKey: string
      originalUserId: string
      originalDeviceId: string
    }

const ROTATE_AFTER_MESSAGES = 100
const ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const ONE_TIME_KEY_TARGET = 50
const DIRECTORY_TTL_MS = 5 * 60 * 1000

export class E2EEngine {
  private vz!: Vz
  private account!: Vodozemac.Account
  private pickleKey!: Uint8Array
  private deviceId = ''
  private secrets: Secrets | null = null
  private identity: Identity | null = null
  private status: EngineStatus = 'needs-identity'
  private queue: Promise<unknown> = Promise.resolve()
  private directory = new Map<string, { at: number; masterKey: string | null; devices: DirectoryDevice[] }>()
  private listeners = new Set<() => void>()
  /** Approval requests from this person's new devices, for the dialog. */
  readonly approvals: ApprovalRequest[] = []
  /** Colleagues whose master key changed since this device first saw it. */
  readonly changedKeys = new Set<string>()

  /** Sessions this tab already asked for: one request per session and page load. */
  private requestedKeys = new Set<string>()

  constructor(
    readonly userId: string,
    private readonly store: CryptoStore,
    private readonly api: KeysApi,
    /** Current members of a conversation, for answering key requests. */
    private readonly membersOf: (conversationId: string) => Promise<string[]>,
    private readonly deviceLabel = '',
  ) {}

  get currentStatus(): EngineStatus {
    return this.status
  }

  get currentDeviceId(): string {
    return this.deviceId
  }

  /** Re-renders the parts of the UI that show the status, approvals or warnings. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /** Resolves once queued work (a key request sent in the background) is done. */
  async whenIdle(): Promise<void> {
    await this.queue
  }

  // Pickles and IndexedDB are read-modify-write. One operation at a time per tab (the queue) and
  // across the person's tabs (a Web Lock): two tabs advancing the same Olm or Megolm ratchet from
  // the same pickle would break it, and two first starts would register two devices.
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const locked = () => withLock(`vana-e2e-${this.userId}`, async () => {
      await this.reloadFromStore()
      return task()
    })
    const run = this.queue.then(locked, locked)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Another tab may have moved the account on (keys used, device approved) since we last looked. */
  private async reloadFromStore(): Promise<void> {
    if (!this.vz || !this.pickleKey) return
    const pickle = await this.store.get<string>('meta', 'account')
    if (pickle) {
      this.account?.free()
      this.account = this.vz.Account.from_pickle(pickle, this.pickleKey)
    }
    this.secrets = (await this.store.get<Secrets>('meta', 'secrets')) ?? null
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  init(): Promise<EngineStatus> {
    return this.serial(async () => {
      this.vz = await loadVodozemac()
      let pickleKey = await this.store.get<string>('meta', 'pickleKey')
      if (!pickleKey) {
        pickleKey = toBase64(randomBytes(32))
        await this.store.put('meta', 'pickleKey', pickleKey)
      }
      this.pickleKey = fromBase64(pickleKey)
      const accountPickle = await this.store.get<string>('meta', 'account')
      this.account = accountPickle ? this.vz.Account.from_pickle(accountPickle, this.pickleKey) : new this.vz.Account()
      this.deviceId = (await this.store.get<string>('meta', 'deviceId')) ?? ''
      this.secrets = (await this.store.get<Secrets>('meta', 'secrets')) ?? null

      let me = this.deviceId ? await this.api.me(this.deviceId) : null
      if (!this.deviceId || !me?.devices.some((device) => device.id === this.deviceId)) {
        // New here, or the server dropped this device (session revoked): start a fresh account
        // and drop cached session/plaintext stores so a revoked session leaves nothing behind.
        if (this.deviceId) {
          this.account = new this.vz.Account()
          this.secrets = null
          await this.store.delete('meta', 'secrets')
          await Promise.all(['olm', 'outbound', 'inbound', 'plain'].map((s) => this.store.clear(s as 'olm')))
        }
        await this.registerDevice()
        me = await this.api.me(this.deviceId)
      }
      if (me.oneTimeKeys !== null && me.oneTimeKeys < ONE_TIME_KEY_TARGET / 2) await this.topUpKeys()
      this.identity = me.identity
      this.status = await this.computeStatus(me.devices)
      this.emit()
      return this.status
    })
  }

  private async computeStatus(myDevices: DirectoryDevice[]): Promise<EngineStatus> {
    if (!this.identity) return 'needs-identity'
    const mine = myDevices.find((device) => device.id === this.deviceId)
    const signed =
      mine?.masterSignature &&
      (await verifyMaster(this.identity.masterKey, deviceSignaturePayload(mine), mine.masterSignature))
    if (!signed || !this.secrets) return 'needs-approval'
    // Secrets from an identity that was reset elsewhere are stale.
    if ((await masterPublicOf(this.secrets.masterPrivate)) !== this.identity.masterKey) return 'needs-approval'
    return 'ready'
  }

  private async saveAccount(): Promise<void> {
    await this.store.put('meta', 'account', this.account.pickle(this.pickleKey))
  }

  private async registerDevice(): Promise<void> {
    this.account.generate_one_time_keys(ONE_TIME_KEY_TARGET)
    this.account.generate_fallback_key()
    const { id } = await this.api.registerDevice({
      publicIdentityKey: this.account.curve25519_key,
      signingKey: this.account.ed25519_key,
      label: this.deviceLabel,
      oneTimeKeys: keyList(this.account.one_time_keys),
      fallbackKey: keyList(this.account.fallback_key)[0],
    })
    this.account.mark_keys_as_published()
    this.deviceId = id
    await this.saveAccount()
    await this.store.put('meta', 'deviceId', id)
  }

  private async topUpKeys(): Promise<void> {
    this.account.generate_one_time_keys(ONE_TIME_KEY_TARGET / 2)
    await this.api.uploadKeys(this.deviceId, { oneTimeKeys: keyList(this.account.one_time_keys) })
    this.account.mark_keys_as_published()
    await this.saveAccount()
  }

  // ── Identity, recovery key, approval ──────────────────────────────────────

  /** First device (or a reset): makes the master key and the recovery key, shown once. */
  createIdentity(reset = false): Promise<string> {
    return this.serial(async () => {
      const master = await newMasterKey()
      const recovery = await newRecoveryKey()
      const { backupKey, check } = await deriveFromRecoveryKey(recovery.bytes)
      const device = await this.ownDirectoryEntry()
      await this.api.putIdentity({
        masterKey: master.publicKey,
        recoveryCheck: check,
        secretBundle: await seal(backupKey, JSON.stringify({ masterPrivate: master.privatePkcs8 }), 'secret-bundle'),
        deviceId: this.deviceId,
        deviceSignature: await signWithMaster(master.privatePkcs8, deviceSignaturePayload(device)),
        reset,
      })
      await this.saveSecrets({ masterPrivate: master.privatePkcs8, backupKey: toBase64(backupKey) })
      this.identity = (await this.api.me(this.deviceId)).identity
      if (reset) {
        // The old backup is gone on the server: what this device holds goes up again.
        for (const record of await this.store.values<InboundRecord>('inbound')) {
          await this.store.put('inbound', record.sessionId, { ...record, backedUp: false })
        }
      }
      await this.backupPending()
      this.status = 'ready'
      this.emit()
      return recovery.text
    })
  }

  /** False on a wrong key (typo or another person's). */
  restoreWithRecoveryKey(text: string): Promise<boolean> {
    return this.serial(async () => {
      const bytes = await parseRecoveryKey(text)
      if (!bytes) return false
      const me = await this.api.me(this.deviceId)
      if (!me.identity) return false
      const { backupKey, check } = await deriveFromRecoveryKey(bytes)
      if (unpadded(check) !== unpadded(me.identity.recoveryCheck)) return false
      const { masterPrivate } = JSON.parse(await open(backupKey, me.identity.secretBundle, 'secret-bundle')) as { masterPrivate: string }
      if ((await masterPublicOf(masterPrivate)) !== me.identity.masterKey) return false
      this.identity = me.identity
      await this.saveSecrets({ masterPrivate, backupKey: toBase64(backupKey) })
      const device = await this.ownDirectoryEntry()
      await this.api.signDevice(this.deviceId, await signWithMaster(masterPrivate, deviceSignaturePayload(device)))
      await this.restoreBackupUnlocked()
      this.status = 'ready'
      this.emit()
      return true
    })
  }

  /** On the new device: asks this person's signed devices; returns the code to compare. */
  requestApproval(): Promise<string> {
    return this.serial(async () => {
      const device = await this.ownDirectoryEntry()
      const requestId = crypto.randomUUID()
      await this.store.put('meta', 'approvalRequest', requestId)
      const targets = (await this.trustedDevices(this.userId, true)).filter((d) => d.id !== this.deviceId)
      await this.sendOlm(targets, () => ({ type: 'approval_request', requestId }))
      return approvalCode(device)
    })
  }

  /** On an approved device, after the person compared the two codes. */
  approve(request: ApprovalRequest): Promise<void> {
    return this.serial(async () => {
      if (!this.secrets) throw new Error('this device holds no secrets')
      await this.api.signDevice(
        request.device.id,
        await signWithMaster(this.secrets.masterPrivate, deviceSignaturePayload(request.device)),
      )
      this.directory.delete(this.userId)
      const secrets = this.secrets
      await this.sendOlm([request.device], () => ({
        type: 'approval_secret',
        requestId: request.requestId,
        masterPrivate: secrets.masterPrivate,
        backupKey: secrets.backupKey,
      }))
      this.dismissApproval(request.requestId)
    })
  }

  dismissApproval(requestId: string): void {
    const index = this.approvals.findIndex((request) => request.requestId === requestId)
    if (index >= 0) this.approvals.splice(index, 1)
    this.emit()
  }

  private async saveSecrets(secrets: Secrets): Promise<void> {
    this.secrets = secrets
    await this.store.put('meta', 'secrets', secrets)
  }

  private async ownDirectoryEntry(): Promise<DirectoryDevice> {
    const me = await this.api.me(this.deviceId)
    const device = me.devices.find((d) => d.id === this.deviceId)
    if (!device || device.publicIdentityKey !== this.account.curve25519_key) throw new Error('device not registered')
    return device
  }

  // ── Directory and trust ───────────────────────────────────────────────────

  /** A colleague's device list changed (SSE `keys.devices`). */
  forgetDevices(userId: string): void {
    this.directory.delete(userId)
  }

  /**
   * Devices signed by the person's master key. The master key is pinned on first sight (TOFU);
   * a different one later is accepted, so messaging goes on after a reset, but flagged.
   */
  private async trustedDevices(userId: string, includeUnsigned = false): Promise<DirectoryDevice[]> {
    let entry = this.directory.get(userId)
    if (!entry || Date.now() - entry.at > DIRECTORY_TTL_MS) {
      const [fresh] = await this.api.devicesOf([userId])
      entry = { at: Date.now(), masterKey: fresh?.masterKey ?? null, devices: fresh?.devices ?? [] }
      this.directory.set(userId, entry)
    }
    if (!entry.masterKey) return []
    const masterKey = entry.masterKey
    if (userId === this.userId) {
      // Our own master key is known exactly: no pinning needed.
      if (this.identity && masterKey !== this.identity.masterKey) return []
    } else {
      const pinned = await this.store.get<string>('meta', `pin:${userId}`)
      if (pinned && pinned !== masterKey) {
        this.changedKeys.add(userId)
        this.emit()
      }
      if (pinned !== masterKey) await this.store.put('meta', `pin:${userId}`, masterKey)
    }
    const trusted: DirectoryDevice[] = []
    for (const device of entry.devices) {
      const signed =
        device.masterSignature !== null &&
        (await verifyMaster(masterKey, deviceSignaturePayload(device), device.masterSignature))
      if (signed || includeUnsigned) trusted.push(device)
    }
    return trusted
  }

  private async deviceByIdentityKey(userId: string, identityKey: string): Promise<DirectoryDevice | undefined> {
    const find = async () => (await this.trustedDevices(userId)).find((d) => d.publicIdentityKey === identityKey)
    const found = await find()
    if (found) return found
    // A device approved a moment ago is not in the cached list yet.
    this.directory.delete(userId)
    return find()
  }

  // ── Olm ───────────────────────────────────────────────────────────────────

  private async olmSessions(identityKey: string): Promise<Vodozemac.Session[]> {
    const pickles = (await this.store.get<string[]>('olm', identityKey)) ?? []
    return pickles.map((pickle) => this.vz.Session.from_pickle(pickle, this.pickleKey))
  }

  private async saveOlmSessions(identityKey: string, sessions: Vodozemac.Session[]): Promise<void> {
    // A handful per peer is plenty; an old one only matters for a message still in flight.
    await this.store.put('olm', identityKey, sessions.slice(0, 5).map((session) => session.pickle(this.pickleKey)))
    for (const session of sessions) session.free()
  }

  /** Encrypts one Olm payload per device and queues them; devices without keys are skipped. */
  private async sendOlm(
    devices: DirectoryDevice[],
    payloadFor: (device: DirectoryDevice) => Record<string, unknown>,
  ): Promise<string[]> {
    if (devices.length === 0) return []
    const sessionsByDevice = new Map<string, Vodozemac.Session[]>()
    const needKeys: DirectoryDevice[] = []
    for (const device of devices) {
      const sessions = await this.olmSessions(device.publicIdentityKey)
      sessionsByDevice.set(device.id, sessions)
      if (sessions.length === 0) needKeys.push(device)
    }
    if (needKeys.length > 0) {
      const claimed = await this.api.claim(needKeys.map((device) => device.id))
      for (const key of claimed) {
        const device = needKeys.find((d) => d.id === key.deviceId)
        if (!device) continue
        const session = this.account.create_outbound_session(
          device.publicIdentityKey,
          key.publicKey,
          this.vz.SessionConfigVersion.V2,
        )
        sessionsByDevice.set(device.id, [session])
      }
    }
    const messages: { deviceId: string; messageType: 0 | 1; ciphertext: string }[] = []
    for (const device of devices) {
      const sessions = sessionsByDevice.get(device.id) ?? []
      const session = sessions[0]
      if (session) {
        const payload = { ...payloadFor(device), sender: this.deviceId, recipient: device.id }
        const message = session.encrypt(JSON.stringify(payload))
        messages.push({ deviceId: device.id, messageType: message.message_type as 0 | 1, ciphertext: toBase64(message.ciphertext) })
        message.free()
      }
      await this.saveOlmSessions(device.publicIdentityKey, sessions)
    }
    if (messages.length > 0) await this.api.sendToDevice(this.deviceId, messages)
    return messages.map((message) => message.deviceId)
  }

  private async decryptOlm(item: PendingToDevice): Promise<OlmPayload | null> {
    const sessions = await this.olmSessions(item.senderIdentityKey)
    const message = new this.vz.OlmMessage(item.messageType, fromBase64(item.ciphertext))
    try {
      for (const [index, session] of sessions.entries()) {
        if (item.messageType === 0 && !session.session_matches(message)) continue
        try {
          const plaintext = session.decrypt(message)
          // The session that just worked goes first: the next reply uses it.
          sessions.unshift(...sessions.splice(index, 1))
          await this.saveOlmSessions(item.senderIdentityKey, sessions)
          return parsePayload(plaintext)
        } catch {
          // Not this session; a normal message carries no hint which one, so try the next.
        }
      }
      if (item.messageType !== 0) {
        await this.saveOlmSessions(item.senderIdentityKey, sessions)
        return null
      }
      const created = this.account.create_inbound_session(item.senderIdentityKey, message)
      await this.saveAccount()
      const plaintext = created.plaintext
      await this.saveOlmSessions(item.senderIdentityKey, [created.session, ...sessions])
      return parsePayload(plaintext)
    } catch {
      return null
    } finally {
      message.free()
    }
  }

  /** Reads this device's queue on the server (SSE `keys.to_device`, start, a missing key). */
  syncToDevice(): Promise<number> {
    return this.serial(async () => {
      let handled = 0
      for (;;) {
        const pending = await this.api.pendingToDevice(this.deviceId)
        if (pending.length === 0) break
        for (const item of pending) {
          const payload = await this.decryptOlm(item)
          // Redirected or replayed: the server cannot forge the payload, only misroute it.
          if (payload && payload.sender === item.senderDeviceId && payload.recipient === this.deviceId) {
            await this.handleOlm(item, payload)
            handled++
          }
        }
        await this.api.ackToDevice(this.deviceId, pending[pending.length - 1]!.id)
        if (pending.length < 100) break
      }
      const me = await this.api.me(this.deviceId)
      if (me.oneTimeKeys !== null && me.oneTimeKeys < ONE_TIME_KEY_TARGET / 2) await this.topUpKeys()
      if (handled > 0) {
        await this.backupPending()
        this.emit()
      }
      return handled
    })
  }

  private async handleOlm(item: PendingToDevice, payload: OlmPayload): Promise<void> {
    if (payload.type === 'room_key') {
      // Only from a signed device of the person the server says sent it.
      const sender = await this.deviceByIdentityKey(item.senderUserId, item.senderIdentityKey)
      if (!sender || sender.id !== item.senderDeviceId) return
      const inbound = new this.vz.InboundGroupSession(payload.sessionKey, this.vz.GroupSessionVersion.V2)
      if (inbound.session_id !== payload.sessionId) {
        inbound.free()
        return
      }
      await this.keepInbound(inbound, {
        conversationId: payload.conversationId,
        senderUserId: item.senderUserId,
        senderDeviceId: item.senderDeviceId,
      })
      return
    }
    if (payload.type === 'key_request') {
      if (this.status !== 'ready') return
      const requester = await this.deviceByIdentityKey(item.senderUserId, item.senderIdentityKey)
      if (requester && requester.id === item.senderDeviceId) {
        await this.answerKeyRequest(requester, payload.conversationId, payload.sessionId)
      }
      return
    }
    if (payload.type === 'forwarded_key') {
      const forwarder = await this.deviceByIdentityKey(item.senderUserId, item.senderIdentityKey)
      if (!forwarder || forwarder.id !== item.senderDeviceId) return
      // Accepted from the author, or from our own devices; anyone else could hand us a key they
      // made and have their words shown under the author's name.
      if (item.senderUserId !== payload.originalUserId && item.senderUserId !== this.userId) return
      const session = this.vz.InboundGroupSession.import(payload.sessionKey, this.vz.GroupSessionVersion.V2)
      if (session.session_id !== payload.sessionId) {
        session.free()
        return
      }
      await this.keepInbound(session, {
        conversationId: payload.conversationId,
        senderUserId: payload.originalUserId,
        senderDeviceId: payload.originalDeviceId,
      })
      return
    }
    if (item.senderUserId !== this.userId) return
    if (payload.type === 'approval_request') {
      if (this.status !== 'ready') return
      // The asking device registered a moment ago: never in the cached list.
      this.directory.delete(this.userId)
      const device = (await this.trustedDevices(this.userId, true)).find((d) => d.id === item.senderDeviceId)
      if (!device || device.publicIdentityKey !== item.senderIdentityKey || device.masterSignature) return
      if (this.approvals.some((request) => request.requestId === payload.requestId)) return
      this.approvals.push({ requestId: payload.requestId, device, code: await approvalCode(device) })
      return
    }
    if (payload.type === 'approval_secret') {
      if ((await this.store.get<string>('meta', 'approvalRequest')) !== payload.requestId) return
      const sender = await this.deviceByIdentityKey(this.userId, item.senderIdentityKey)
      if (!sender) return
      const me = await this.api.me(this.deviceId)
      if (!me.identity || (await masterPublicOf(payload.masterPrivate)) !== me.identity.masterKey) return
      this.identity = me.identity
      await this.saveSecrets({ masterPrivate: payload.masterPrivate, backupKey: payload.backupKey })
      await this.store.delete('meta', 'approvalRequest')
      await this.restoreBackupUnlocked()
      this.status = await this.computeStatus(me.devices)
    }
  }

  // ── Megolm ────────────────────────────────────────────────────────────────

  private async keepInbound(
    session: Vodozemac.InboundGroupSession,
    meta: { conversationId: string; senderUserId: string; senderDeviceId: string },
  ): Promise<void> {
    const existing = await this.store.get<InboundRecord>('inbound', session.session_id)
    // An earlier first index decrypts more: keep the better copy.
    if (existing && existing.firstIndex <= session.first_known_index) {
      session.free()
      return
    }
    await this.store.put('inbound', session.session_id, {
      pickle: session.pickle(this.pickleKey),
      sessionId: session.session_id,
      firstIndex: session.first_known_index,
      backedUp: false,
      ...meta,
    } satisfies InboundRecord)
    session.free()
  }

  /**
   * Encrypts a message for every signed device of the conversation's members. The Megolm
   * session rotates when someone left (a device it was shared with is no longer a target), after
   * 100 messages or a week.
   */
  encrypt(
    conversationId: string,
    memberUserIds: string[],
    content: MessageContent & { legacy?: true },
  ): Promise<EncryptedContent> {
    return this.serial(async () => {
      if (this.status !== 'ready') throw new Error('encryption not ready on this device')
      const targets: DirectoryDevice[] = []
      for (const userId of new Set([...memberUserIds, this.userId])) {
        targets.push(...(await this.trustedDevices(userId)).filter((device) => device.id !== this.deviceId))
      }
      const targetIds = new Set(targets.map((device) => device.id))

      let record = await this.store.get<OutboundRecord>('outbound', conversationId)
      const stale =
        !record ||
        record.messageCount >= ROTATE_AFTER_MESSAGES ||
        Date.now() - record.createdAt > ROTATE_AFTER_MS ||
        record.sharedWith.some((id) => !targetIds.has(id))
      let session: Vodozemac.GroupSession
      if (stale) {
        session = new this.vz.GroupSession(this.vz.GroupSessionVersion.V2)
        record = { pickle: '', sessionId: session.session_id, createdAt: Date.now(), messageCount: 0, sharedWith: [] }
        // Our own copy, so this device and the backup read what it sent.
        await this.keepInbound(new this.vz.InboundGroupSession(session.session_key, this.vz.GroupSessionVersion.V2), {
          conversationId,
          senderUserId: this.userId,
          senderDeviceId: this.deviceId,
        })
      } else {
        session = this.vz.GroupSession.from_pickle(record!.pickle, this.pickleKey)
      }

      const newTargets = targets.filter((device) => !record!.sharedWith.includes(device.id))
      if (newTargets.length > 0) {
        // The key at the current index: a device added now does not read what came before.
        const sessionKey = session.session_key
        const reached = await this.sendOlm(newTargets, () => ({
          type: 'room_key',
          conversationId,
          sessionId: session.session_id,
          sessionKey,
        }))
        record!.sharedWith.push(...reached)
      }

      const ciphertext = packCiphertext(session.session_id, session.encrypt(JSON.stringify({ v: 1, conversationId, ...content })))
      await this.store.put('outbound', conversationId, {
        ...record!,
        pickle: session.pickle(this.pickleKey),
        messageCount: record!.messageCount + 1,
      } satisfies OutboundRecord)
      session.free()
      await this.backupPending()
      return { v: 1, ciphertext, senderDeviceId: this.deviceId }
    })
  }

  /** Decrypts one message; the result is kept for previews, quotes and search. */
  decrypt(message: {
    id: string
    conversationId: string
    authorUserId: string
    /** Kept with the text for the local search's results. */
    createdAt?: string
    encrypted: { v: number; ciphertext: string; senderDeviceId: string | null }
  }): Promise<DecryptResult> {
    return this.serial(async () => {
      // Keyed by the ciphertext's end too: an edit is a new ciphertext under the same id.
      const cacheKey = `${message.id}:${unpadded(message.encrypted.ciphertext).slice(-24)}`
      const cached = await this.store.get<PlainRecord>('plain', cacheKey)
      if (cached) return { status: 'ok', content: { body: cached.body, attachments: cached.attachments } }
      const packed = unpackCiphertext(message.encrypted.ciphertext)
      if (!packed) return { status: 'invalid' }
      const record = await this.store.get<InboundRecord>('inbound', packed.sessionId)
      if (!record) {
        this.requestKey(message.conversationId, message.authorUserId, packed.sessionId)
        return { status: 'missing-key' }
      }
      // A key from Ana's device decrypts only Ana's messages, in the conversation it was sent for.
      if (record.conversationId !== message.conversationId) return { status: 'invalid' }
      const session = this.vz.InboundGroupSession.from_pickle(record.pickle, this.pickleKey)
      try {
        const decrypted = session.decrypt(packed.ciphertext)
        const parsed = JSON.parse(decrypted.plaintext) as Partial<MessageContent> & { v?: number; conversationId?: string; legacy?: boolean }
        decrypted.free()
        if (parsed.v !== 1 || parsed.conversationId !== message.conversationId) return { status: 'invalid' }
        // The one case where the key is not the author's: an old clear message re-encrypted by a
        // colleague because its author has no approved device left (the server allows nothing else).
        if (record.senderUserId !== message.authorUserId && parsed.legacy !== true) return { status: 'invalid' }
        const content: MessageContent = { body: String(parsed.body ?? ''), attachments: parsed.attachments ?? [] }
        await this.store.put('plain', cacheKey, {
          messageId: message.id,
          conversationId: message.conversationId,
          authorUserId: message.authorUserId,
          createdAt: message.createdAt,
          ...content,
        } satisfies PlainRecord)
        return { status: 'ok', content }
      } catch {
        // Before the first known index (key shared after this message) or corrupt.
        this.requestKey(message.conversationId, message.authorUserId, packed.sessionId)
        return { status: 'missing-key' }
      } finally {
        session.free()
      }
    })
  }

  /**
   * Asks the author's devices and this person's other devices for a key this device lacks: a
   * colleague who joined the group later, or opened Mesaje for the first time after being written
   * to. Answers arrive as `forwarded_key` over to-device. Not awaited: decrypt stays fast.
   */
  private requestKey(conversationId: string, authorUserId: string, sessionId: string): void {
    if (this.status !== 'ready' || this.requestedKeys.has(sessionId)) return
    this.requestedKeys.add(sessionId)
    void this.serial(async () => {
      const targets = [
        ...(await this.trustedDevices(authorUserId)),
        ...(authorUserId === this.userId ? [] : await this.trustedDevices(this.userId)),
      ].filter((device) => device.id !== this.deviceId)
      await this.sendOlm(targets, () => ({ type: 'key_request', conversationId, sessionId }))
    }).catch(() => this.requestedKeys.delete(sessionId))
  }

  private async answerKeyRequest(requester: DirectoryDevice, conversationId: string, sessionId: string): Promise<void> {
    const record = await this.store.get<InboundRecord>('inbound', sessionId)
    if (!record || record.conversationId !== conversationId) return
    // Our own devices get any key. Someone else only gets keys of messages *we* wrote, and only
    // while they are in the conversation: we vouch for our own words, never for a third person's.
    if (requester.userId !== this.userId) {
      if (record.senderUserId !== this.userId) return
      if (!(await this.membersOf(conversationId)).includes(requester.userId)) return
    }
    const session = this.vz.InboundGroupSession.from_pickle(record.pickle, this.pickleKey)
    const sessionKey = session.export_at(record.firstIndex)
    session.free()
    if (!sessionKey) return
    await this.sendOlm([requester], () => ({
      type: 'forwarded_key',
      conversationId,
      sessionId,
      sessionKey,
      originalUserId: record.senderUserId,
      originalDeviceId: record.senderDeviceId,
    }))
  }

  /** What this device has decrypted in the conversation: the local search (no server search with E2E). */
  async decryptedIn(conversationId: string): Promise<PlainRecord[]> {
    return (await this.store.values<PlainRecord>('plain')).filter((record) => record.conversationId === conversationId)
  }

  // ── Backup ────────────────────────────────────────────────────────────────

  private async backupPending(): Promise<void> {
    if (!this.secrets) return
    const backupKey = fromBase64(this.secrets.backupKey)
    const pending = (await this.store.values<InboundRecord>('inbound')).filter((record) => !record.backedUp)
    for (let i = 0; i < pending.length; i += 100) {
      const batch = pending.slice(i, i + 100)
      const sessions = []
      for (const record of batch) {
        const session = this.vz.InboundGroupSession.from_pickle(record.pickle, this.pickleKey)
        const exported = session.export_at(record.firstIndex)
        session.free()
        if (!exported) continue
        const data = await seal(
          backupKey,
          JSON.stringify({
            sessionKey: exported,
            conversationId: record.conversationId,
            senderUserId: record.senderUserId,
            senderDeviceId: record.senderDeviceId,
          }),
          `backup:${record.sessionId}`,
        )
        sessions.push({ sessionId: record.sessionId, firstIndex: record.firstIndex, data })
      }
      await this.api.putBackup(sessions)
      for (const record of batch) await this.store.put('inbound', record.sessionId, { ...record, backedUp: true })
    }
  }

  restoreBackup(): Promise<void> {
    return this.serial(() => this.restoreBackupUnlocked())
  }

  private async restoreBackupUnlocked(): Promise<void> {
    if (!this.secrets) return
    const backupKey = fromBase64(this.secrets.backupKey)
    let after = 0
    for (;;) {
      const rows = await this.api.readBackup(after)
      for (const row of rows) {
        try {
          const meta = JSON.parse(await open(backupKey, row.data, `backup:${row.sessionId}`)) as {
            sessionKey: string
            conversationId: string
            senderUserId: string
            senderDeviceId: string
          }
          const session = this.vz.InboundGroupSession.import(meta.sessionKey, this.vz.GroupSessionVersion.V2)
          if (session.session_id !== row.sessionId) {
            session.free()
            continue
          }
          await this.keepInbound(session, meta)
          const kept = await this.store.get<InboundRecord>('inbound', row.sessionId)
          if (kept && kept.firstIndex >= row.firstIndex) await this.store.put('inbound', row.sessionId, { ...kept, backedUp: true })
        } catch {
          // Written under an older recovery key, or damaged: skip it, the rest still restores.
        }
      }
      if (rows.length < 500) break
      after = rows[rows.length - 1]!.id
    }
  }
}

function withLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  // Web Locks are everywhere the engine runs (Chrome 69, Safari 15.4, Firefox 96); tests have none.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? (locks.request(name, task) as Promise<T>) : task()
}

function keyList(keys: unknown): { keyId: string; publicKey: string }[] {
  const entries = keys instanceof Map ? [...keys.entries()] : Object.entries((keys ?? {}) as Record<string, string>)
  return entries.map(([keyId, publicKey]) => ({ keyId: String(keyId), publicKey: String(publicKey) }))
}

function parsePayload(plaintext: string): OlmPayload | null {
  try {
    const payload = JSON.parse(plaintext) as OlmPayload
    return typeof payload?.type === 'string' && typeof payload.sender === 'string' ? payload : null
  } catch {
    return null
  }
}

// A Megolm message does not name its session (Matrix sends the id next to it, in the event).
// Here it travels in the same opaque field: base64 of "<session id>|<Megolm ciphertext>".
function packCiphertext(sessionId: string, ciphertext: string): string {
  return toBase64(new TextEncoder().encode(`${sessionId}|${ciphertext}`))
}

function unpackCiphertext(packed: string): { sessionId: string; ciphertext: string } | null {
  try {
    const text = new TextDecoder().decode(fromBase64(packed))
    const separator = text.indexOf('|')
    if (separator <= 0) return null
    return { sessionId: text.slice(0, separator), ciphertext: text.slice(separator + 1) }
  } catch {
    return null
  }
}
