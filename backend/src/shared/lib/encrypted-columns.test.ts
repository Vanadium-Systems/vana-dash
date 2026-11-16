import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../db/client.js'
import { billingClients, platforms } from '../db/schema/index.js'
import { decryptField, encryptApiKey, hmacField, isV1 } from './crypto.js'
import { convertTenant, countLegacyValues } from './encrypted-columns.js'
import { normalizeIban } from './iban.js'
import { getOwnerTenantId } from './tenancy.js'

const created = { platformId: '', clientId: '' }

afterAll(async () => {
  if (created.platformId) await db.delete(platforms).where(eq(platforms.id, created.platformId))
  if (created.clientId) await db.delete(billingClients).where(eq(billingClients.id, created.clientId))
})

describe('convertTenant (scripts/encrypt-v1.ts)', () => {
  it('turns a pre-v1 key into v1 and a plaintext IBAN into iban_enc + iban_hmac', async () => {
    const [platform] = await db
      .insert(platforms)
      .values({ name: 'Acme encrypt-v1', type: 'vanagreen', apiUrl: 'https://example.com', apiKeyEnc: encryptApiKey('acme-key') })
      .returning({ id: platforms.id })
    created.platformId = platform!.id
    const [client] = await db
      .insert(billingClients)
      .values({ name: 'Acme SRL', cif: 'RO1', address: 'Str. Test 1', iban: 'ro49 aaaa 1b31 0075 9384 0000' })
      .returning({ id: billingClients.id })
    created.clientId = client!.id

    const before = await countLegacyValues()
    expect(before['platforms.apiKeyEnc']).toBeGreaterThanOrEqual(1)
    expect(before['billing_clients.iban']).toBeGreaterThanOrEqual(1)

    const dry = await convertTenant(getOwnerTenantId(), { dryRun: true, batchSize: 1, pauseMs: 0 })
    expect(dry['platforms.apiKeyEnc']).toBe(1)
    const [untouched] = await db.select().from(platforms).where(eq(platforms.id, created.platformId))
    expect(isV1(untouched!.apiKeyEnc)).toBe(false)

    // batchSize 1: the loop has to come back for every row.
    await convertTenant(getOwnerTenantId(), { dryRun: false, batchSize: 1, pauseMs: 0 })

    const [p] = await db.select().from(platforms).where(eq(platforms.id, created.platformId))
    expect(isV1(p!.apiKeyEnc)).toBe(true)
    expect(await decryptField(p!.apiKeyEnc)).toBe('acme-key')

    const [c] = await db.select().from(billingClients).where(eq(billingClients.id, created.clientId))
    expect(c!.iban).toBeNull()
    expect(await decryptField(c!.ibanEnc!)).toBe('ro49 aaaa 1b31 0075 9384 0000')
    expect(c!.ibanHmac).toBe(await hmacField(normalizeIban('RO49AAAA1B31007593840000')))

    const after = await countLegacyValues()
    expect(after['platforms.apiKeyEnc']).toBeUndefined()
    expect(after['billing_clients.iban']).toBeUndefined()
  })
})
