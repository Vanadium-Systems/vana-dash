import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { tenantKeys } from '../db/schema/index.js'
import { currentTenantId, withRlsBypass } from './tenancy.js'

// Envelope encryption, AES-256-GCM everywhere.
//   stored value:  v1:<keyId>:base64(iv[12] | tag[16] | ciphertext)
//   keyId:         a row of tenant_keys, the company's data key wrapped with the master key
// Values written before v1 have no prefix and were encrypted with the master key directly;
// decryptField still reads them until scripts/encrypt-v1.ts has converted every row.
// MASTER_ENCRYPTION_KEY / MASTER_ENCRYPTION_KEY_NEXT = 32 bytes hex (openssl rand -hex 32).

const IV_LENGTH = 12
const TAG_LENGTH = 16
const V1_PREFIX = 'v1:'

function parseMasterKey(hex: string, name: string): Buffer {
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes hex (64 chars)`)
  return key
}

/** The current master key first, then the next one while a rotation is under way. */
function masterKeys(): Buffer[] {
  const keys = [parseMasterKey(config.masterEncryptionKey, 'MASTER_ENCRYPTION_KEY')]
  if (config.masterEncryptionKeyNext) {
    keys.push(parseMasterKey(config.masterEncryptionKeyNext, 'MASTER_ENCRYPTION_KEY_NEXT'))
  }
  return keys
}

function seal(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

function open(key: Buffer, payload: string): Buffer {
  const raw = Buffer.from(payload, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_LENGTH))
  decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH))
  return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()])
}

/** Tries each master key; GCM rejects the wrong one. */
function openWithMaster(payload: string): Buffer {
  for (const key of masterKeys()) {
    try {
      return open(key, payload)
    } catch {
      // next key
    }
  }
  throw new Error('[crypto] value does not decrypt with MASTER_ENCRYPTION_KEY or MASTER_ENCRYPTION_KEY_NEXT')
}

// Unwrapped data keys, by company and keyId, and the active keyId of each company. The company is
// part of the cache key so a ciphertext of company A never decrypts in company B's context, even
// once A's key is in memory. A master rotation does not change a data key, so neither cache goes
// stale when it runs.
const dataKeys = new Map<string, Buffer>()
const activeKeyIds = new Map<string, string>()

/** Empties the caches; for tests that swap MASTER_ENCRYPTION_KEY. */
export function forgetDataKeys(): void {
  dataKeys.clear()
  activeKeyIds.clear()
}

// The filters on tenant_id below are on purpose, unlike in services: with RLS_ENABLED=false they
// are the only thing that stops one company's ciphertext from decrypting under another's context.
async function loadDataKey(keyId: string): Promise<Buffer> {
  const tenantId = currentTenantId()
  const cacheKey = `${tenantId}:${keyId}`
  const cached = dataKeys.get(cacheKey)
  if (cached) return cached
  const [row] = await db
    .select({ wrappedKey: tenantKeys.wrappedKey })
    .from(tenantKeys)
    .where(and(eq(tenantKeys.keyId, keyId), eq(tenantKeys.tenantId, tenantId)))
  if (!row) throw new Error(`[crypto] data key ${keyId} not found for this company`)
  const key = openWithMaster(row.wrappedKey)
  dataKeys.set(cacheKey, key)
  return key
}

async function activeDataKey(): Promise<{ keyId: string; key: Buffer }> {
  const tenantId = currentTenantId()
  const cachedId = activeKeyIds.get(tenantId)
  if (cachedId) return { keyId: cachedId, key: await loadDataKey(cachedId) }

  const findActive = () =>
    db
      .select({ keyId: tenantKeys.keyId })
      .from(tenantKeys)
      .where(and(eq(tenantKeys.tenantId, tenantId), isNull(tenantKeys.retiredAt)))
  let [row] = await findActive()
  if (!row) {
    // A concurrent first encryption may win the partial unique index; then we read its key.
    // tenant_id is explicit: with RLS off the column default does not see runAsTenant. The last
    // master key wraps it, so a key created during a rotation survives the switch to NEXT.
    await db
      .insert(tenantKeys)
      .values({ tenantId, keyId: randomBytes(8).toString('hex'), wrappedKey: seal(masterKeys().at(-1)!, randomBytes(32)) })
      .onConflictDoNothing()
    ;[row] = await findActive()
    if (!row) throw new Error('[crypto] could not create the data key of this company')
  }
  activeKeyIds.set(tenantId, row.keyId)
  return { keyId: row.keyId, key: await loadDataKey(row.keyId) }
}

/** Encrypts a secret with the current company's data key. */
export async function encryptField(plaintext: string): Promise<string> {
  const { keyId, key } = await activeDataKey()
  return `${V1_PREFIX}${keyId}:${seal(key, Buffer.from(plaintext, 'utf8'))}`
}

/** Decrypts a value written by encryptField, or a pre-v1 value. Throws on a wrong key or tampering. */
export async function decryptField(stored: string): Promise<string> {
  if (!stored.startsWith(V1_PREFIX)) return openWithMaster(stored).toString('utf8')
  const sep = stored.indexOf(':', V1_PREFIX.length)
  if (sep < 0) throw new Error('[crypto] malformed v1 value')
  const key = await loadDataKey(stored.slice(V1_PREFIX.length, sep))
  return open(key, stored.slice(sep + 1)).toString('utf8')
}

/** HMAC-SHA256 under a key derived from the company's data key: lets two values be compared
 *  (an IBAN against another) without decrypting either. Survives a master key rotation; a new
 *  data key for the company would mean recomputing the stored HMACs (scripts/encrypt-v1.ts). */
export async function hmacField(value: string): Promise<string> {
  const { key } = await activeDataKey()
  const hmacKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'vana-dash field hmac v1', 32))
  return createHmac('sha256', hmacKey).update(value, 'utf8').digest('base64url')
}

export function isV1(stored: string): boolean {
  return stored.startsWith(V1_PREFIX)
}

/** Master key rotation: re-wraps every company's data key with MASTER_ENCRYPTION_KEY_NEXT. The
 *  encrypted data is not touched. Afterwards NEXT becomes MASTER_ENCRYPTION_KEY and NEXT is unset. */
export async function rewrapTenantKeys(): Promise<number> {
  if (!config.masterEncryptionKeyNext) throw new Error('[crypto] MASTER_ENCRYPTION_KEY_NEXT is not set')
  const next = parseMasterKey(config.masterEncryptionKeyNext, 'MASTER_ENCRYPTION_KEY_NEXT')
  // The keys of every company: a platform operation, run from a script, not from a request.
  return withRlsBypass(async () => {
    const rows = await db.select({ keyId: tenantKeys.keyId, wrappedKey: tenantKeys.wrappedKey }).from(tenantKeys)
    for (const row of rows) {
      const wrappedKey = seal(next, openWithMaster(row.wrappedKey))
      await db.update(tenantKeys).set({ wrappedKey }).where(eq(tenantKeys.keyId, row.keyId))
    }
    return rows.length
  })
}

/** Comparație constant-time (Track A) — pt. secrete comparate direct (ex. X-Ingest-Token),
 *  nu decriptate din DB. `timingSafeEqual` cere buffere de aceeași lungime — verificăm
 *  lungimea înainte, altfel ar arunca (nu doar întoarce false) pe input de lungime diferită. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Writes a pre-v1 value (master key, no prefix). Only for tests of the conversion. */
export function encryptApiKey(plaintext: string): string {
  return seal(masterKeys()[0]!, Buffer.from(plaintext, 'utf8'))
}
