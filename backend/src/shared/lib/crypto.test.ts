import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { tenantKeys, tenants } from '../db/schema/index.js'
import { decryptField, encryptApiKey, encryptField, forgetDataKeys, hmacField, isV1, rewrapTenantKeys } from './crypto.js'
import { runAsTenant, withRlsBypass } from './tenancy.js'

const TEST_MASTER = config.masterEncryptionKey
const OTHER_MASTER = 'b'.repeat(64)
let otherTenantId: string

beforeAll(async () => {
  const [row] = await withRlsBypass(() =>
    db
      .insert(tenants)
      .values({ name: 'Acme crypto test', slug: `acme-crypto-${Date.now()}`, country: 'RO', timeZone: 'Europe/Bucharest', currency: 'RON' })
      .returning({ id: tenants.id }),
  )
  otherTenantId = row!.id
})

afterAll(async () => {
  await withRlsBypass(async () => {
    await db.delete(tenantKeys).where(eq(tenantKeys.tenantId, otherTenantId))
    await db.delete(tenants).where(eq(tenants.id, otherTenantId))
  })
})

afterEach(() => {
  config.masterEncryptionKey = TEST_MASTER
  config.masterEncryptionKeyNext = ''
  forgetDataKeys()
})

describe('encryptField / decryptField (v1)', () => {
  it('roundtrips, with the v1 prefix and the company key id', async () => {
    const stored = await encryptField('secret-api-key-12345')
    expect(stored).toMatch(/^v1:[0-9a-f]{16}:/)
    expect(await decryptField(stored)).toBe('secret-api-key-12345')
  })

  it('handles unicode and uses a fresh IV each time', async () => {
    const plaintext = 'cheie-secretă-ăîșț-🔑' // slop-ok: unicode round-trip case
    const a = await encryptField(plaintext)
    expect(a).not.toBe(await encryptField(plaintext))
    expect(await decryptField(a)).toBe(plaintext)
  })

  it('reads a pre-v1 value, and re-encrypting it gives v1', async () => {
    const legacy = encryptApiKey('legacy-secret')
    expect(isV1(legacy)).toBe(false)
    const plain = await decryptField(legacy)
    expect(plain).toBe('legacy-secret')
    const v1 = await encryptField(plain)
    expect(isV1(v1)).toBe(true)
    expect(await decryptField(v1)).toBe('legacy-secret')
  })

  it('rejects tampered ciphertext', async () => {
    const stored = await encryptField('secret')
    const sep = stored.lastIndexOf(':')
    const raw = Buffer.from(stored.slice(sep + 1), 'base64')
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff
    await expect(decryptField(stored.slice(0, sep + 1) + raw.toString('base64'))).rejects.toThrow()
  })

  it('fails with a wrong master key, both for v1 and for pre-v1 values', async () => {
    const v1 = await encryptField('secret')
    const legacy = encryptApiKey('secret')
    forgetDataKeys()
    config.masterEncryptionKey = OTHER_MASTER
    await expect(decryptField(v1)).rejects.toThrow(/MASTER_ENCRYPTION_KEY/)
    await expect(decryptField(legacy)).rejects.toThrow(/MASTER_ENCRYPTION_KEY/)
  })

  it("does not decrypt another company's value", async () => {
    const ownerValue = await encryptField('owner-secret')
    const otherValue = await runAsTenant(otherTenantId, () => encryptField('other-secret'))
    expect(otherValue.split(':')[1]).not.toBe(ownerValue.split(':')[1])
    expect(await runAsTenant(otherTenantId, () => decryptField(otherValue))).toBe('other-secret')
    // Owner's key already in memory: the cache must not hand it to the other company.
    expect(await decryptField(ownerValue)).toBe('owner-secret')
    await expect(runAsTenant(otherTenantId, () => decryptField(ownerValue))).rejects.toThrow(/not found/)
  })

  it('rotates the master key without touching the data', async () => {
    const stored = await encryptField('survives-rotation')
    try {
      config.masterEncryptionKeyNext = OTHER_MASTER
      expect(await rewrapTenantKeys()).toBeGreaterThan(0)
      // The switch on the server: NEXT becomes the master key, NEXT goes away.
      config.masterEncryptionKey = OTHER_MASTER
      config.masterEncryptionKeyNext = ''
      forgetDataKeys()
      expect(await decryptField(stored)).toBe('survives-rotation')
    } finally {
      // Back to the key the rest of the suite uses.
      config.masterEncryptionKey = OTHER_MASTER
      config.masterEncryptionKeyNext = TEST_MASTER
      await rewrapTenantKeys()
    }
    config.masterEncryptionKey = TEST_MASTER
    config.masterEncryptionKeyNext = ''
    forgetDataKeys()
    expect(await decryptField(stored)).toBe('survives-rotation')
  })
})

describe('hmacField', () => {
  it('is stable for a company and differs between companies', async () => {
    const a = await hmacField('RO49AAAA1B31007593840000')
    expect(await hmacField('RO49AAAA1B31007593840000')).toBe(a)
    expect(await hmacField('RO49AAAA1B31007593840001')).not.toBe(a)
    expect(await runAsTenant(otherTenantId, () => hmacField('RO49AAAA1B31007593840000'))).not.toBe(a)
  })
})
