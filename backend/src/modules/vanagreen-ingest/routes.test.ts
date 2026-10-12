/**
 * POST /api/v1/integrations/vanagreen/pricing/calculate + /billing-clients — verifică granița
 * rutei (auth fail-closed pe fiecare token separat, kill-switch → 503, shape răspuns), pattern
 * identic modules/webhooks/vanagreen-routes.test.ts. Logica de calcul/creare are propriile teste
 * în service.test.ts.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { billingClients, dashboardConfig, platforms } from '../../shared/db/schema/index.js'
import { encryptApiKey } from '../../shared/lib/crypto.js'
import { upsertConfig } from '../pricing/service.js'
import { setSelfServePricingEnabled } from './service.js'

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const PRICING_TOKEN = config.vanagreenPricingIngestToken
const BILLING_TOKEN = config.vanagreenBillingIngestToken
const TOGGLE_KEY = 'vanagreen_selfserve_pricing_enabled'

const platformIds: string[] = []
const clientIds: string[] = []

const MINIMAL_CONFIG = {
  basePrice: 100,
  operatorDesktopRate: 20,
  operatorMobilRate: 15,
  documenteIncluse: 150,
  documentBands: [{ upTo: null, rate: null }],
  fluxDeeeDelta: 30,
  addons: [
    { key: 'treatment', label: 'Tratări', price: 40 },
    { key: 'signature_pad', label: 'Semnătură digitală', price: 10 },
    { key: 'id_scanner', label: 'Scanner buletine', price: 20 },
  ],
  bundles: [],
  cantarRate: 50,
  cantarSetupPrice: 50,
  siatdFloorPrice: 65,
  siatdFloorUnits: 40,
  siatdUnitPrice: 1.5,
  lunileAnuale: 10,
  puncteBands: [{ max: null, mult: 1, label: 'orice nr. de puncte' }],
  onboardingBase: 150,
  onboardingOpRate: 15,
  onboardingDeeeDelta: 50,
  onboardingSiatdSetup: 40,
  equipmentItems: [],
}

async function makeVanagreenPlatform() {
  const [row] = await db
    .insert(platforms)
    .values({ name: 'QA Route VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKeyEnc: encryptApiKey('x') })
    .returning()
  platformIds.push(row!.id)
  return row!
}

function samplePricingPayload() {
  return {
    workPoints: 3,
    desktopOperators: 2,
    mobileSeats: 1,
    documentsPerMonth: 0,
    siatdPurchasesPerMonth: 0,
    flavor: 'simple' as const,
    addons: ['treatment'] as const,
    includeOnboarding: false,
  }
}

afterEach(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
  if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds.splice(0)))
})

afterAll(async () => {
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
})

describe('POST /api/v1/integrations/vanagreen/pricing/calculate', () => {
  it('respinge cu 401 dacă VANAGREEN_PRICING_INGEST_TOKEN nu e configurat', async () => {
    config.vanagreenPricingIngestToken = ''
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/vanagreen/pricing/calculate',
        headers: { 'x-ingest-token': 'anything' },
        payload: samplePricingPayload(),
      })
      expect(res.statusCode).toBe(401)
    } finally {
      config.vanagreenPricingIngestToken = PRICING_TOKEN
    }
  })

  it('respinge cu 401 pt. un token greșit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/pricing/calculate',
      headers: { 'x-ingest-token': 'not-the-real-token' },
      payload: samplePricingPayload(),
    })
    expect(res.statusCode).toBe(401)
  })

  it('respinge cu 401 dacă e trimis billing token-ul în loc de pricing token-ul (secrete distincte)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/pricing/calculate',
      headers: { 'x-ingest-token': BILLING_TOKEN },
      payload: samplePricingPayload(),
    })
    expect(res.statusCode).toBe(401)
  })

  it('răspunde 503 dacă kill-switch-ul e OFF (același fallback ca down/timeout, fără câmp special)', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)
    await setSelfServePricingEnabled(false)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/pricing/calculate',
      headers: { 'x-ingest-token': PRICING_TOKEN },
      payload: samplePricingPayload(),
    })
    expect(res.statusCode).toBe(503)
  })

  it('răspunde 503 dacă platforma vanagreen nu e configurată (nicio setare, fără platformă/config)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/pricing/calculate',
      headers: { 'x-ingest-token': PRICING_TOKEN },
      payload: samplePricingPayload(),
    })
    expect(res.statusCode).toBe(503)
  })

  it('acceptă (200) un token valid și întoarce cota FĂRĂ wrapper {success,data} și FĂRĂ breakdown', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/pricing/calculate',
      headers: { 'x-ingest-token': PRICING_TOKEN },
      payload: samplePricingPayload(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // bază 100×1 + operator desktop extra 1×20 + operator mobil 1×15 + addon tratări 40 = 175
    // (fără rată separată per punct extra — eliminată 2026-08-05, dubla multiplierul benzii;
    // vezi calc.test.ts pt. formulă)
    expect(body).toEqual({ totalMonthly: 175, totalAnnual: 1750, onboardingTotal: null, currency: 'EUR' })
    expect(body).not.toHaveProperty('breakdown')
    expect(body).not.toHaveProperty('success')
  })

  it("acceptă 'signature_pad'/'id_scanner' în addons + câmpul 'cantare' — NU 400 pe .strict() (handoff recyclers_app, 2026-08-07)", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/pricing/calculate',
      headers: { 'x-ingest-token': PRICING_TOKEN },
      payload: { ...samplePricingPayload(), addons: ['treatment', 'signature_pad', 'id_scanner'], cantare: 2 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // 175 (bază, ca testul de mai sus) + 10 (semnătură) + 20 (scanner) + 2×50 (cântare) = 305
    expect(body).toEqual({ totalMonthly: 305, totalAnnual: 3050, onboardingTotal: null, currency: 'EUR' })
  })

  it("acceptă 'bundle' — NU 400 pe .strict() (2026-08-20, catalog dinamic, nu enum fix)", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, { ...MINIMAL_CONFIG, bundles: [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment'], price: 35, onboardingPrice: 50 }] })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/pricing/calculate',
      headers: { 'x-ingest-token': PRICING_TOKEN },
      payload: { ...samplePricingPayload(), addons: [], bundle: 'starter' },
    })
    expect(res.statusCode).toBe(200)
    // 135 (bază — ca testul "acceptă 'signature_pad'.../id_scanner'" de mai sus) + 35 (pachet fix)
    expect(res.json().totalMonthly).toBe(135 + 35)
  })
})

describe('GET /api/v1/integrations/vanagreen/pricing/bundles', () => {
  it('respinge cu 401 fără token valid', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/integrations/vanagreen/pricing/bundles', headers: { 'x-ingest-token': 'greșit' } })
    expect(res.statusCode).toBe(401)
  })

  it('întoarce catalogul de pachete al platformei configurate', async () => {
    const platform = await makeVanagreenPlatform()
    const bundles = [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment'], price: 35, onboardingPrice: 50 }]
    await upsertConfig(platform.id, { ...MINIMAL_CONFIG, bundles })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/vanagreen/pricing/bundles',
      headers: { 'x-ingest-token': PRICING_TOKEN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: bundles })
  })

  it('array gol dacă platforma vanagreen nu e configurată', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/vanagreen/pricing/bundles',
      headers: { 'x-ingest-token': PRICING_TOKEN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: [] })
  })
})

describe('POST /api/v1/integrations/vanagreen/billing-clients', () => {
  function samplePayload(tenantId: string) {
    return {
      vanagreenTenantId: tenantId,
      companyName: 'QA Route Billing SRL',
      contactEmail: 'route@example.com',
      quotedMonthlyTotal: 255,
      quotedAnnualTotal: 2550,
      needsBillingInfo: true as const,
      autoInvoiceEnabled: false as const,
    }
  }

  it('respinge cu 401 dacă VANAGREEN_BILLING_INGEST_TOKEN nu e configurat', async () => {
    config.vanagreenBillingIngestToken = ''
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/vanagreen/billing-clients',
        headers: { 'x-ingest-token': 'anything' },
        payload: samplePayload('qa-route-billing-1'),
      })
      expect(res.statusCode).toBe(401)
    } finally {
      config.vanagreenBillingIngestToken = BILLING_TOKEN
    }
  })

  it('respinge cu 401 dacă e trimis pricing token-ul în loc de billing token-ul', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/billing-clients',
      headers: { 'x-ingest-token': PRICING_TOKEN },
      payload: samplePayload('qa-route-billing-2'),
    })
    expect(res.statusCode).toBe(401)
  })

  it('acceptă (200) un token valid și creează billing_client-ul schelet', async () => {
    const tenantId = `qa-route-billing-${Date.now()}`
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/vanagreen/billing-clients',
      headers: { 'x-ingest-token': BILLING_TOKEN },
      payload: samplePayload(tenantId),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true })

    const [row] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, tenantId))
    expect(row).toBeDefined()
    clientIds.push(row!.id)
    expect(row!.needsBillingInfo).toBe(true)
    expect(row!.cif).toBe('')
  })
})
