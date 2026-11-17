import { createPublicKey, verify } from 'node:crypto'
import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import {
  keyBackupSessions,
  toDeviceMessages,
  userCryptoIdentities,
  userDeviceKeys,
  userDevices,
  userSessions,
  users,
} from '../../shared/db/schema/index.js'

// Key directory and transport for end-to-end encrypted messages (PLAN.md part M). The server
// never sees a private key or a plaintext; what it guards is who may publish keys for whom.
// Every device action checks that the device is the caller's own and still active: a device of
// someone else answers like a missing one (404), as for any personal object.

export class DeviceNotFoundError extends Error {
  constructor() {
    super('device not found')
  }
}

export class KeysConflictError extends Error {
  constructor(public readonly code: 'IDENTITY_EXISTS' | 'BAD_SIGNATURE' | 'NO_IDENTITY') {
    super(code)
  }
}

const MAX_ONE_TIME_KEYS_PER_DEVICE = 100

// Signed by the owner's master key; the browser builds the same string (crypto/trust.ts).
export function deviceSignaturePayload(device: { id: string; publicIdentityKey: string; signingKey: string }): string {
  return `vana-dash-device:v1:${device.id}:${device.publicIdentityKey}:${device.signingKey}`
}

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function verifyMasterSignature(masterKey: string, payload: string, signature: string): boolean {
  try {
    const raw = Buffer.from(masterKey, 'base64')
    if (raw.length !== 32) return false
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
    return verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

// A device counts while it is not revoked and the login that registered it is still alive.
const deviceActive = sql`${userDevices.revokedAt} is null and (${userDevices.sessionFamilyId} is null or exists (
  select 1 from ${userSessions}
  where ${userSessions.familyId} = ${userDevices.sessionFamilyId}
    and ${userSessions.revokedAt} is null and ${userSessions.expiresAt} > now()))`

const devicePublicFields = {
  id: userDevices.id,
  userId: userDevices.userId,
  label: userDevices.label,
  publicIdentityKey: userDevices.publicIdentityKey,
  signingKey: userDevices.signingKey,
  masterSignature: userDevices.masterSignature,
  createdAt: userDevices.createdAt,
  lastSeenAt: userDevices.lastSeenAt,
}

/** The caller's own active device, or DeviceNotFoundError. */
export async function ownDevice(userId: string, deviceId: string) {
  const [device] = await db
    .select(devicePublicFields)
    .from(userDevices)
    .where(and(eq(userDevices.id, deviceId), eq(userDevices.userId, userId), deviceActive))
  if (!device) throw new DeviceNotFoundError()
  return device
}

export interface RegisterDeviceInput {
  publicIdentityKey: string
  signingKey: string
  label: string
  oneTimeKeys: { keyId: string; publicKey: string }[]
  fallbackKey?: { keyId: string; publicKey: string }
}

/** Idempotent on the identity key, so a retried registration does not leave a twin device. */
export async function registerDevice(userId: string, sessionFamilyId: string | null, input: RegisterDeviceInput) {
  const [existing] = await db
    .select({ id: userDevices.id, userId: userDevices.userId, revokedAt: userDevices.revokedAt })
    .from(userDevices)
    .where(eq(userDevices.publicIdentityKey, input.publicIdentityKey))
  if (existing) {
    // Someone else's identity key, or a revoked device coming back: neither is reused.
    if (existing.userId !== userId || existing.revokedAt) throw new KeysConflictError('IDENTITY_EXISTS')
    return { id: existing.id }
  }
  const [row] = await db
    .insert(userDevices)
    .values({
      userId,
      sessionFamilyId,
      label: input.label,
      publicIdentityKey: input.publicIdentityKey,
      signingKey: input.signingKey,
    })
    .returning({ id: userDevices.id })
  const keys = [
    ...input.oneTimeKeys.slice(0, MAX_ONE_TIME_KEYS_PER_DEVICE).map((key) => ({ ...key, fallback: false })),
    ...(input.fallbackKey ? [{ ...input.fallbackKey, fallback: true }] : []),
  ]
  if (keys.length > 0) {
    await db
      .insert(userDeviceKeys)
      .values(keys.map((key) => ({ deviceId: row!.id, ...key })))
      .onConflictDoNothing()
  }
  return { id: row!.id }
}

export async function addOneTimeKeys(
  userId: string,
  deviceId: string,
  keys: { keyId: string; publicKey: string }[],
  fallbackKey?: { keyId: string; publicKey: string },
): Promise<number> {
  await ownDevice(userId, deviceId)
  if (fallbackKey) {
    await db.delete(userDeviceKeys).where(and(eq(userDeviceKeys.deviceId, deviceId), eq(userDeviceKeys.fallback, true)))
    await db
      .insert(userDeviceKeys)
      .values({ deviceId, keyId: fallbackKey.keyId, publicKey: fallbackKey.publicKey, fallback: true })
      .onConflictDoNothing()
  }
  if (keys.length > 0) {
    await db
      .insert(userDeviceKeys)
      .values(keys.map((key) => ({ deviceId, keyId: key.keyId, publicKey: key.publicKey })))
      .onConflictDoNothing()
  }
  const count = await oneTimeKeyCount(deviceId)
  if (count > MAX_ONE_TIME_KEYS_PER_DEVICE) {
    // A client in a loop would otherwise grow the table without bound; the oldest go first.
    await db.execute(sql`delete from ${userDeviceKeys} where ${userDeviceKeys.id} in (
      select ${userDeviceKeys.id} from ${userDeviceKeys}
      where ${userDeviceKeys.deviceId} = ${deviceId} and not ${userDeviceKeys.fallback}
      order by ${userDeviceKeys.id} limit ${count - MAX_ONE_TIME_KEYS_PER_DEVICE})`)
  }
  return Math.min(count, MAX_ONE_TIME_KEYS_PER_DEVICE)
}

async function oneTimeKeyCount(deviceId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userDeviceKeys)
    .where(and(eq(userDeviceKeys.deviceId, deviceId), eq(userDeviceKeys.fallback, false)))
  return row?.n ?? 0
}

/** What a device needs at start: the person's identity, their devices, its own key count. */
export async function myKeys(userId: string, deviceId: string | undefined) {
  const [identity] = await db
    .select({
      masterKey: userCryptoIdentities.masterKey,
      recoveryCheck: userCryptoIdentities.recoveryCheck,
      secretBundle: userCryptoIdentities.secretBundle,
      version: userCryptoIdentities.version,
    })
    .from(userCryptoIdentities)
    .where(eq(userCryptoIdentities.userId, userId))
  // The login each device belongs to, for Profile → Devices; only ever in the person's own list.
  const devices = await db
    .select({ ...devicePublicFields, sessionFamilyId: userDevices.sessionFamilyId })
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), deviceActive))
    .orderBy(asc(userDevices.createdAt))
  let oneTimeKeys: number | null = null
  if (deviceId && devices.some((device) => device.id === deviceId)) {
    oneTimeKeys = await oneTimeKeyCount(deviceId)
    await db.update(userDevices).set({ lastSeenAt: new Date() }).where(eq(userDevices.id, deviceId))
  }
  return { identity: identity ?? null, devices, oneTimeKeys }
}

export interface IdentityInput {
  masterKey: string
  recoveryCheck: string
  secretBundle: string
  /** The device creating the identity signs itself in the same step. */
  deviceId: string
  deviceSignature: string
  /** Replace an existing identity (lost recovery key): old backups go, other devices lose their signature. */
  reset?: boolean
}

export async function putIdentity(userId: string, input: IdentityInput) {
  const device = await ownDevice(userId, input.deviceId)
  if (!verifyMasterSignature(input.masterKey, deviceSignaturePayload(device), input.deviceSignature)) {
    throw new KeysConflictError('BAD_SIGNATURE')
  }
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ version: userCryptoIdentities.version })
      .from(userCryptoIdentities)
      .where(eq(userCryptoIdentities.userId, userId))
      .for('update')
    if (existing && !input.reset) throw new KeysConflictError('IDENTITY_EXISTS')
    if (existing) {
      await tx
        .update(userCryptoIdentities)
        .set({
          masterKey: input.masterKey,
          recoveryCheck: input.recoveryCheck,
          secretBundle: input.secretBundle,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(userCryptoIdentities.userId, userId))
      await tx.delete(keyBackupSessions).where(eq(keyBackupSessions.userId, userId))
      await tx.update(userDevices).set({ masterSignature: null }).where(eq(userDevices.userId, userId))
    } else {
      await tx.insert(userCryptoIdentities).values({
        userId,
        masterKey: input.masterKey,
        recoveryCheck: input.recoveryCheck,
        secretBundle: input.secretBundle,
      })
    }
    await tx.update(userDevices).set({ masterSignature: input.deviceSignature }).where(eq(userDevices.id, input.deviceId))
  })
}

/** A device approved by recovery key or from another device: signed with the master key. */
export async function signDevice(userId: string, deviceId: string, signature: string) {
  const device = await ownDevice(userId, deviceId)
  const [identity] = await db
    .select({ masterKey: userCryptoIdentities.masterKey })
    .from(userCryptoIdentities)
    .where(eq(userCryptoIdentities.userId, userId))
  if (!identity) throw new KeysConflictError('NO_IDENTITY')
  if (!verifyMasterSignature(identity.masterKey, deviceSignaturePayload(device), signature)) {
    throw new KeysConflictError('BAD_SIGNATURE')
  }
  await db.update(userDevices).set({ masterSignature: signature }).where(eq(userDevices.id, deviceId))
}

export async function revokeDevice(userId: string, deviceId: string) {
  const updated = await db
    .update(userDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(userDevices.id, deviceId), eq(userDevices.userId, userId), isNull(userDevices.revokedAt)))
    .returning({ id: userDevices.id })
  if (updated.length === 0) throw new DeviceNotFoundError()
  // Its queue and keys are useless now and would otherwise wait for nobody.
  await db.delete(toDeviceMessages).where(eq(toDeviceMessages.recipientDeviceId, deviceId))
  await db.delete(userDeviceKeys).where(eq(userDeviceKeys.deviceId, deviceId))
}

/** Public keys of colleagues' active devices. Inactive people are left out like in the team list. */
export async function devicesOf(userIds: string[]) {
  if (userIds.length === 0) return []
  const people = await db
    .select({ userId: users.id, masterKey: userCryptoIdentities.masterKey })
    .from(users)
    .leftJoin(userCryptoIdentities, eq(userCryptoIdentities.userId, users.id))
    .where(inArray(users.id, userIds))
  const devices = await db
    .select(devicePublicFields)
    .from(userDevices)
    .where(and(inArray(userDevices.userId, userIds), deviceActive))
    .orderBy(asc(userDevices.createdAt))
  return people.map((person) => ({
    userId: person.userId,
    masterKey: person.masterKey,
    devices: devices.filter((device) => device.userId === person.userId),
  }))
}

/**
 * One key per device to start an Olm session: a one-time key, deleted as it is handed out, or the
 * fallback key once those ran out. `for update skip locked` keeps two senders from getting the same key.
 */
export async function claimKeys(deviceIds: string[]) {
  const claimed: { deviceId: string; keyId: string; publicKey: string }[] = []
  for (const deviceId of deviceIds) {
    const [active] = await db.select({ id: userDevices.id }).from(userDevices).where(and(eq(userDevices.id, deviceId), deviceActive))
    if (!active) continue
    const rows = await db.execute<{ key_id: string; public_key: string }>(sql`
      delete from ${userDeviceKeys} where ${userDeviceKeys.id} = (
        select ${userDeviceKeys.id} from ${userDeviceKeys}
        where ${userDeviceKeys.deviceId} = ${deviceId} and not ${userDeviceKeys.fallback}
        order by ${userDeviceKeys.id} limit 1 for update skip locked)
      returning ${userDeviceKeys.keyId} as key_id, ${userDeviceKeys.publicKey} as public_key`)
    const oneTime = rows[0]
    if (oneTime) {
      claimed.push({ deviceId, keyId: oneTime.key_id, publicKey: oneTime.public_key })
      continue
    }
    const [fallback] = await db
      .select({ keyId: userDeviceKeys.keyId, publicKey: userDeviceKeys.publicKey })
      .from(userDeviceKeys)
      .where(and(eq(userDeviceKeys.deviceId, deviceId), eq(userDeviceKeys.fallback, true)))
    if (fallback) claimed.push({ deviceId, ...fallback })
  }
  return claimed
}

export interface ToDeviceInput {
  deviceId: string
  messageType: number
  ciphertext: string
}

/** Queues Olm messages from the caller's device; returns the people to wake over SSE. */
export async function sendToDevice(userId: string, senderDeviceId: string, items: ToDeviceInput[]): Promise<string[]> {
  await ownDevice(userId, senderDeviceId)
  const recipients = await db
    .select({ id: userDevices.id, userId: userDevices.userId })
    .from(userDevices)
    .where(and(inArray(userDevices.id, [...new Set(items.map((item) => item.deviceId))]), deviceActive))
  const owners = new Map(recipients.map((device) => [device.id, device.userId]))
  const rows = items.filter((item) => owners.has(item.deviceId))
  if (rows.length > 0) {
    await db.insert(toDeviceMessages).values(
      rows.map((item) => ({
        recipientDeviceId: item.deviceId,
        senderDeviceId,
        messageType: item.messageType,
        ciphertext: item.ciphertext,
      })),
    )
  }
  return [...new Set(rows.map((item) => owners.get(item.deviceId)!))]
}

export async function pendingToDevice(userId: string, deviceId: string, limit: number) {
  await ownDevice(userId, deviceId)
  return db
    .select({
      id: toDeviceMessages.id,
      senderDeviceId: toDeviceMessages.senderDeviceId,
      senderUserId: userDevices.userId,
      senderIdentityKey: userDevices.publicIdentityKey,
      messageType: toDeviceMessages.messageType,
      ciphertext: toDeviceMessages.ciphertext,
      createdAt: toDeviceMessages.createdAt,
    })
    .from(toDeviceMessages)
    .innerJoin(userDevices, eq(userDevices.id, toDeviceMessages.senderDeviceId))
    .where(eq(toDeviceMessages.recipientDeviceId, deviceId))
    .orderBy(asc(toDeviceMessages.id))
    .limit(limit)
}

export async function ackToDevice(userId: string, deviceId: string, upToId: number) {
  await ownDevice(userId, deviceId)
  await db
    .delete(toDeviceMessages)
    .where(and(eq(toDeviceMessages.recipientDeviceId, deviceId), lte(toDeviceMessages.id, upToId)))
}

/** Upserts encrypted session exports; an export from an earlier index replaces a later one. */
export async function putBackup(userId: string, sessions: { sessionId: string; firstIndex: number; data: string }[]) {
  if (sessions.length === 0) return
  await db
    .insert(keyBackupSessions)
    .values(sessions.map((session) => ({ userId, ...session })))
    .onConflictDoUpdate({
      target: [keyBackupSessions.userId, keyBackupSessions.sessionId],
      set: { firstIndex: sql`excluded.first_index`, data: sql`excluded.data`, updatedAt: new Date() },
      setWhere: sql`excluded.first_index < ${keyBackupSessions.firstIndex}`,
    })
}

export async function readBackup(userId: string, after: number, limit: number) {
  return db
    .select({
      id: keyBackupSessions.id,
      sessionId: keyBackupSessions.sessionId,
      firstIndex: keyBackupSessions.firstIndex,
      data: keyBackupSessions.data,
    })
    .from(keyBackupSessions)
    .where(and(eq(keyBackupSessions.userId, userId), gt(keyBackupSessions.id, after)))
    .orderBy(asc(keyBackupSessions.id))
    .limit(limit)
}

/** Whether the device sent by the client for a message is the author's own, active one. */
export async function isOwnActiveDevice(userId: string, deviceId: string): Promise<boolean> {
  const [device] = await db
    .select({ id: userDevices.id })
    .from(userDevices)
    .where(and(eq(userDevices.id, deviceId), eq(userDevices.userId, userId), deviceActive))
  return Boolean(device)
}

/** True when the person has no active signed device: their old messages may be re-encrypted by others. */
export async function hasSignedDevice(userId: string): Promise<boolean> {
  const [device] = await db
    .select({ id: userDevices.id })
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), sql`${userDevices.masterSignature} is not null`, deviceActive))
  return Boolean(device)
}
