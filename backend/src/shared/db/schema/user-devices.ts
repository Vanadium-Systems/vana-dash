import { bigserial, boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// End-to-end encrypted messages (PLAN.md part M). The server only stores public keys and
// ciphertext it cannot open: every private key lives on the person's devices, or in
// `secret_bundle`, encrypted with a key derived from their recovery key.

// One browser or APK install. Tied to the login session family that registered it, so revoking
// that session takes the device out of every key list without a second revoke step.
export const userDevices = pgTable(
  'user_devices',
  {
    ...tenantColumns,
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionFamilyId: uuid('session_family_id'),
    label: text('label').notNull().default(''),
    // Curve25519 (Olm) and Ed25519 (the device's own signing key), base64 as vodozemac gives them.
    publicIdentityKey: text('public_identity_key').notNull(),
    signingKey: text('signing_key').notNull(),
    // The owner's master key signing this device. Null until the device is approved; colleagues
    // send message keys only to signed devices.
    masterSignature: text('master_signature'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_user_devices_identity_key').on(t.tenantId, t.publicIdentityKey),
    index('idx_user_devices_user').on(t.userId),
  ],
)

// Olm one-time keys and the fallback key, claimed one per new session.
export const userDeviceKeys = pgTable(
  'user_device_keys',
  {
    ...tenantColumns,
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => userDevices.id, { onDelete: 'cascade' }),
    keyId: text('key_id').notNull(),
    publicKey: text('public_key').notNull(),
    // The fallback key is handed out when the one-time keys run out and is not deleted on claim.
    fallback: boolean('fallback').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_user_device_keys').on(t.deviceId, t.keyId)],
)

// The person's cross-signing identity: master public key, the check that tells a typed recovery
// key apart from a wrong one, and the secrets (master private key, backup key) encrypted with it.
export const userCryptoIdentities = pgTable(
  'user_crypto_identities',
  {
    ...tenantColumns,
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    masterKey: text('master_key').notNull(),
    recoveryCheck: text('recovery_check').notNull(),
    secretBundle: text('secret_bundle').notNull(),
    // Bumped on reset: backups made under an older version are dropped.
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
)

// Megolm inbound sessions exported and encrypted with the backup key, so a new device reads history.
export const keyBackupSessions = pgTable(
  'key_backup_sessions',
  {
    ...tenantColumns,
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    // Lower is better: an export from an earlier index decrypts more messages.
    firstIndex: integer('first_index').notNull(),
    data: text('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_key_backup_sessions').on(t.userId, t.sessionId)],
)

// Olm-encrypted messages from one device to another (room keys, approval requests, secrets).
// Deleted once the recipient acknowledges them.
export const toDeviceMessages = pgTable(
  'to_device_messages',
  {
    ...tenantColumns,
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    recipientDeviceId: uuid('recipient_device_id')
      .notNull()
      .references(() => userDevices.id, { onDelete: 'cascade' }),
    senderDeviceId: uuid('sender_device_id')
      .notNull()
      .references(() => userDevices.id, { onDelete: 'cascade' }),
    // Olm message type (0 = pre-key, 1 = normal) and its base64 ciphertext.
    messageType: integer('message_type').notNull(),
    ciphertext: text('ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_to_device_messages_recipient').on(t.recipientDeviceId, t.id)],
)
