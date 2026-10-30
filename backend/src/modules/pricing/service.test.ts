/**
 * modules/pricing/service.ts — upsert pe pricing_configs (unique pe platform_id, migrarea
 * 0012). Integration test, pg real (test/setup.ts).
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { platforms, pricingConfigs } from '../../shared/db/schema/index.js'
import { encryptApiKey } from '../../shared/lib/crypto.js'
import { getConfig, upsertConfig } from './service.js'

const platformIds: string[] = []

async function makePlatform(name: string) {
  const [row] = await db
    .insert(platforms)
    .values({ name, type: 'qa-pricing-test', apiUrl: 'https://example.com', apiKeyEnc: encryptApiKey('x') })
    .returning()
  platformIds.push(row!.id)
  return row!
}

afterAll(async () => {
  if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds))
})

const MINIMAL_CONFIG = {
  basePrice: 90,
  operatorDesktopRate: 20,
  operatorMobilRate: 15,
  documenteIncluse: 150,
  documentBands: [{ upTo: null, rate: null }],
  fluxDeeeDelta: 30,
  addons: [
    { key: 'treatment', label: 'Tratări', price: 40 },
    { key: 'pickup', label: 'Programări', price: 30 },
  ],
  bundles: [],
  cantarRate: 50,
  siatdFloorPrice: 65,
  siatdFloorUnits: 40,
  siatdUnitPrice: 1.5,
  lunileAnuale: 10,
  puncteBands: [{ max: null, mult: 1, label: 'orice nr. de puncte' }],
  onboardingHourlyRate: 30,
  onboardingDefaultHours: 5,
  onboardingMarginPercent: 0,
  discountPercent: 0,
  equipmentItems: [],
}

describe('getConfig / upsertConfig', () => {
  it('getConfig returns null when the platform has no config yet', async () => {
    const platform = await makePlatform('QA Pricing Platform A')
    expect(await getConfig(platform.id)).toBeNull()
  })

  it('upsertConfig creates a new row, getConfig reads it back', async () => {
    const platform = await makePlatform('QA Pricing Platform B')
    const row = await upsertConfig(platform.id, MINIMAL_CONFIG)
    expect(row.platformId).toBe(platform.id)

    const fetched = await getConfig(platform.id)
    expect(fetched?.config).toEqual(MINIMAL_CONFIG)
  })

  it('upsertConfig called twice for the same platform UPDATES, does not duplicate (unique on platformId)', async () => {
    const platform = await makePlatform('QA Pricing Platform C')
    await upsertConfig(platform.id, MINIMAL_CONFIG)
    const updated = await upsertConfig(platform.id, { ...MINIMAL_CONFIG, basePrice: 120 })

    expect(updated.config).toMatchObject({ basePrice: 120 })
    const fetched = await getConfig(platform.id)
    expect(fetched?.config).toMatchObject({ basePrice: 120 })
  })

  it('two different platforms get independent configs', async () => {
    const platformA = await makePlatform('QA Pricing Platform D')
    const platformB = await makePlatform('QA Pricing Platform E')
    await upsertConfig(platformA.id, { ...MINIMAL_CONFIG, basePrice: 50 })
    await upsertConfig(platformB.id, { ...MINIMAL_CONFIG, basePrice: 200 })

    expect((await getConfig(platformA.id))?.config).toMatchObject({ basePrice: 50 })
    expect((await getConfig(platformB.id))?.config).toMatchObject({ basePrice: 200 })
  })

  it('getConfig aplică default-uri pt. config-uri pre-Sprint-4/pre-addons/pre-bundles fără equipmentItems/addons/bundles (regresie whitescreen FE)', async () => {
    const platform = await makePlatform('QA Pricing Platform F')
    // Simulăm un rând vechi din DB, scris ÎNAINTE de câmpurile noi — jsonb liber, fără
    // migrare, deci insert direct (nu prin upsertConfig, care ar aplica deja schema curentă).
    const oldShapeConfig: Record<string, unknown> = { ...MINIMAL_CONFIG }
    delete oldShapeConfig.equipmentItems
    delete oldShapeConfig.addons
    delete oldShapeConfig.bundles
    await db.insert(pricingConfigs).values({ platformId: platform.id, config: oldShapeConfig })

    const fetched = await getConfig(platform.id)
    expect(fetched?.config.equipmentItems).toEqual([])
    expect(fetched?.config.addons).toEqual([])
    expect(fetched?.config.bundles).toEqual([])
  })
})
