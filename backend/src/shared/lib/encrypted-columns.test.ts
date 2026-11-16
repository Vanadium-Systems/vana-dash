import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../db/client.js'
import { billingClients, platforms, tenantKeys, tenants } from '../db/schema/index.js'
import { decryptField, encryptApiKey, hmacField, isV1 } from './crypto.js'
import { convertTenant, countLegacyValues } from './encrypted-columns.js'
import { normalizeIban } from './iban.js'
import { runAsTenant, withRlsBypass } from './tenancy.js'

// convertTenant goes through every row of a company, so it runs in a throwaway company: the owner's
// rows in a dev database were encrypted with the .env master key, not the test key.
const tenantId = randomUUID()

afterAll(async () => {
  await withRlsBypass(async () => {
    await db.delete(platforms).where(eq(platforms.tenantId, tenantId))
    await db.delete(billingClients).where(eq(billingClients.tenantId, tenantId))
    await db.delete(tenantKeys).where(eq(tenantKeys.tenantId, tenantId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })
})

describe('convertTenant (scripts/encrypt-v1.ts)', () => {
  it('turns a pre-v1 key into v1 and a plaintext IBAN into iban_enc + iban_hmac', async () => {
    await withRlsBypass(() =>
      db.insert(tenants).values({
        id: tenantId,
        name: 'Acme encrypt-v1',
        slug: `acme-encrypt-v1-${tenantId.slice(0, 8)}`,
        country: 'RO',
        timeZone: 'Europe/Bucharest',
        currency: 'RON',
      }),
    )

    await runAsTenant(tenantId, async () => {
      // tenant_id is explicit: with RLS off the column default does not see runAsTenant.
      const [platform] = await db
        .insert(platforms)
        .values({ tenantId, name: 'Acme encrypt-v1', type: 'vanagreen', apiUrl: 'https://example.com', apiKeyEnc: encryptApiKey('acme-key') })
        .returning({ id: platforms.id })
      const [client] = await db
        .insert(billingClients)
        .values({ tenantId, name: 'Acme SRL', cif: 'RO1', address: 'Str. Test 1', iban: 'ro49 aaaa 1b31 0075 9384 0000' })
        .returning({ id: billingClients.id })

      const before = await countLegacyValues()
      expect(before['platforms.apiKeyEnc']).toBeGreaterThanOrEqual(1)
      expect(before['billing_clients.iban']).toBeGreaterThanOrEqual(1)

      const dry = await convertTenant(tenantId, { dryRun: true, batchSize: 1, pauseMs: 0 })
      expect(dry).toEqual({ 'platforms.apiKeyEnc': 1, 'billing_clients.iban': 1 })
      const [untouched] = await db.select().from(platforms).where(eq(platforms.id, platform!.id))
      expect(isV1(untouched!.apiKeyEnc)).toBe(false)

      // batchSize 1: the loop has to come back for every row.
      await convertTenant(tenantId, { dryRun: false, batchSize: 1, pauseMs: 0 })

      const [p] = await db.select().from(platforms).where(eq(platforms.id, platform!.id))
      expect(isV1(p!.apiKeyEnc)).toBe(true)
      expect(await decryptField(p!.apiKeyEnc)).toBe('acme-key')

      const [c] = await db.select().from(billingClients).where(eq(billingClients.id, client!.id))
      expect(c!.iban).toBeNull()
      expect(await decryptField(c!.ibanEnc!)).toBe('ro49 aaaa 1b31 0075 9384 0000')
      expect(c!.ibanHmac).toBe(await hmacField(normalizeIban('RO49AAAA1B31007593840000')))

      expect(await convertTenant(tenantId, { dryRun: true, batchSize: 1, pauseMs: 0 })).toEqual({})
    })
  })
})
