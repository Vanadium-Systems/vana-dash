/**
 * modules/vanagreen-ingest/service.ts — self-serve pricing quote + billing_client ingest pt.
 * wizard-ul din recyclers_app (contract fix, vezi .github/agents/VANAGREEN.md). Integration test
 * cu pg real (test/setup.ts, pattern identic pricing/service.test.ts).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { billingClients, dashboardConfig, platforms } from '../../shared/db/schema/index.js'
import { encryptApiKey } from '../../shared/lib/crypto.js'
import { upsertConfig } from '../pricing/service.js'
import {
  calculateSelfServeQuote,
  createSelfServeBillingClient,
  isSelfServePricingEnabled,
  listSelfServeBundles,
  setSelfServePricingEnabled,
} from './service.js'

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
    { key: 'pickup', label: 'Programări', price: 30 },
    { key: 'market_prices', label: 'Prețuri pe piață', price: 25 },
    { key: 'nexus', label: 'Nexus', price: 35 },
    { key: 'crm', label: 'CRM', price: 20 },
    { key: 'accounting', label: 'e-Factura', price: 10 },
    { key: 'signature_pad', label: 'Semnătură digitală', price: 10 },
    { key: 'id_scanner', label: 'Scanner buletine', price: 20 },
    { key: 'analytics', label: 'Analytics/BI', price: 15 },
    { key: 'partner_portal', label: 'Portal parteneri', price: 30 },
    { key: 'hr', label: 'Modul HR', price: 30 },
    { key: 'ai_assistant', label: 'VanaGreen AI', price: 25 },
  ],
  bundles: [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment', 'pickup'], price: 55, onboardingPrice: 80 }],
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

function addonPrice(key: string): number {
  return MINIMAL_CONFIG.addons.find((a) => a.key === key)!.price
}

async function makeVanagreenPlatform() {
  const [row] = await db
    .insert(platforms)
    .values({ name: 'QA VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKeyEnc: encryptApiKey('x') })
    .returning()
  platformIds.push(row!.id)
  return row!
}

beforeEach(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
})

afterEach(async () => {
  // Ordine obligatorie: billing_clients referențiază platforms (FK) — șters primul, altfel
  // delete-ul de mai jos pică cu constraint violation și lasă rândul de platformă "orfan"
  // nedeletat, vizibil (fără deletedAt) pt. testele următoare din același fișier.
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
  if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds.splice(0)))
})

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
})

describe('isSelfServePricingEnabled / setSelfServePricingEnabled', () => {
  it('implicit true (spre deosebire de auto-extend, care e implicit false) când niciun rând nu există', async () => {
    expect(await isSelfServePricingEnabled()).toBe(true)
  })

  it('reflectă toggle-ul odată setat', async () => {
    await setSelfServePricingEnabled(false)
    expect(await isSelfServePricingEnabled()).toBe(false)
    await setSelfServePricingEnabled(true)
    expect(await isSelfServePricingEnabled()).toBe(true)
  })
})

describe('calculateSelfServeQuote', () => {
  const baseInput = {
    workPoints: 3,
    desktopOperators: 2,
    mobileSeats: 1,
    documentsPerMonth: 0,
    siatdPurchasesPerMonth: 0,
    flavor: 'simple' as const,
    addons: ['treatment', 'market_prices'] as const,
    bundle: null as string | null,
    addonQuantities: {},
    cantare: 0,
    includeOnboarding: false,
  }

  it('null dacă kill-switch-ul e OFF', async () => {
    await setSelfServePricingEnabled(false)
    await makeVanagreenPlatform()
    expect(await calculateSelfServeQuote({ ...baseInput, addons: [...baseInput.addons] })).toBeNull()
  })

  it('null dacă platforma vanagreen nu e configurată (fără rând type=vanagreen nedeletat)', async () => {
    expect(await calculateSelfServeQuote({ ...baseInput, addons: [...baseInput.addons] })).toBeNull()
  })

  it('null dacă platforma există dar n-are încă pricing_config salvat', async () => {
    await makeVanagreenPlatform()
    expect(await calculateSelfServeQuote({ ...baseInput, addons: [...baseInput.addons] })).toBeNull()
  })

  it('calculează corect și mapează flavor/addons la vocabularul intern', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const quote = await calculateSelfServeQuote({ ...baseInput, addons: [...baseInput.addons] })
    expect(quote).not.toBeNull()
    expect(quote?.currency).toBe('EUR')
    // bază 100×1 + operatori desktop extra 1×20 + operator mobil 1×15 +
    // addon tratări 40 + addon prețuri piață 25 = 100+20+15+40+25 = 200 (fără rată separată
    // per punct extra — eliminată 2026-08-05, dubla multiplierul benzii)
    expect(quote?.totalMonthly).toBe(200)
    expect(quote?.totalAnnual).toBe(2000)
    expect(quote?.onboardingTotal).toBeNull() // includeOnboarding: false

    const withOnboarding = await calculateSelfServeQuote({ ...baseInput, addons: [...baseInput.addons], includeOnboarding: true })
    expect(withOnboarding?.onboardingTotal).not.toBeNull()
    expect(typeof withOnboarding?.onboardingTotal).toBe('number')
  })

  it('flavor deee_dba adaugă fluxDeeeDelta', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const standard = await calculateSelfServeQuote({ ...baseInput, addons: [], flavor: 'simple' })
    const deee = await calculateSelfServeQuote({ ...baseInput, addons: [], flavor: 'deee_dba' })
    expect(deee!.totalMonthly - standard!.totalMonthly).toBe(MINIMAL_CONFIG.fluxDeeeDelta)
  })

  it("addon 'accounting' mapează la addonEfactura", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const without = await calculateSelfServeQuote({ ...baseInput, addons: [] })
    const withAccounting = await calculateSelfServeQuote({ ...baseInput, addons: ['accounting'] })
    expect(withAccounting!.totalMonthly - without!.totalMonthly).toBe(addonPrice('accounting'))
  })

  it("addon-uri 'signature_pad'/'id_scanner' mapează la addonSemnaturaDigitala/addonScannerBuletine (handoff recyclers_app, 2026-08-07)", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const without = await calculateSelfServeQuote({ ...baseInput, addons: [] })
    const withBoth = await calculateSelfServeQuote({ ...baseInput, addons: ['signature_pad', 'id_scanner'] })
    expect(withBoth!.totalMonthly - without!.totalMonthly).toBe(addonPrice('signature_pad') + addonPrice('id_scanner'))
  })

  it("addon-uri 'analytics'/'partner_portal' mapează la addonAnalytics/addonPartnerPortal (gap închis 2026-08-19, semnalat din recyclers_app VANADASH.md)", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const without = await calculateSelfServeQuote({ ...baseInput, addons: [] })
    const withBoth = await calculateSelfServeQuote({ ...baseInput, addons: ['analytics', 'partner_portal'] })
    expect(withBoth!.totalMonthly - without!.totalMonthly).toBe(addonPrice('analytics') + addonPrice('partner_portal'))
  })

  it("addon-uri 'hr'/'ai_assistant' mapează la addonHr/addonAiAssistant (F14/F13, livrate + expuse self-serve 2026-08-19)", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const without = await calculateSelfServeQuote({ ...baseInput, addons: [] })
    const withBoth = await calculateSelfServeQuote({ ...baseInput, addons: ['hr', 'ai_assistant'] })
    expect(withBoth!.totalMonthly - without!.totalMonthly).toBe(addonPrice('hr') + addonPrice('ai_assistant'))
  })

  it("câmp 'cantare' mapează 1:1 (nume identic pe ambele părți ale contractului) — adaugă cantare × cantarRate", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const without = await calculateSelfServeQuote({ ...baseInput, addons: [] })
    const withScales = await calculateSelfServeQuote({ ...baseInput, addons: [], cantare: 3 })
    expect(withScales!.totalMonthly - without!.totalMonthly).toBe(3 * MINIMAL_CONFIG.cantarRate)
  })

  it('documentsPerMonth peste cota inclusă e taxat pe benzi', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, { ...MINIMAL_CONFIG, documenteIncluse: 150, documentBands: [{ upTo: 500, rate: 2 }] })

    const included = await calculateSelfServeQuote({ ...baseInput, addons: [], documentsPerMonth: 150 })
    const over = await calculateSelfServeQuote({ ...baseInput, addons: [], documentsPerMonth: 200 })
    expect(over!.totalMonthly - included!.totalMonthly).toBe(50 * 2) // 50 documente peste cotă × 2
  })

  it('siatdPurchasesPerMonth adaugă costul robotului SIATD', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const without = await calculateSelfServeQuote({ ...baseInput, addons: [], siatdPurchasesPerMonth: 0 })
    const withSiatd = await calculateSelfServeQuote({ ...baseInput, addons: [], siatdPurchasesPerMonth: 10 })
    expect(withSiatd!.totalMonthly).toBeGreaterThan(without!.totalMonthly)
  })

  it('null (nu preț parțial) dacă documentsPerMonth depășește ultima bandă calculabilă (manualReviewNeeded)', async () => {
    const platform = await makeVanagreenPlatform()
    // MINIMAL_CONFIG.documentBands = [{ upTo: null, rate: null }] — orice depășire e "manual".
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const quote = await calculateSelfServeQuote({ ...baseInput, addons: [], documentsPerMonth: 999 })
    expect(quote).toBeNull()
  })

  it("'bundle' trece direct în selectedBundleKey (același vocabular ca addons — vezi VANAGREEN.md)", async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const withoutBundle = await calculateSelfServeQuote({ ...baseInput, addons: [], bundle: null })
    const withBundle = await calculateSelfServeQuote({ ...baseInput, addons: [], bundle: 'starter' })
    // MINIMAL_CONFIG.bundles[0] = 'starter': treatment+pickup la preț fix 55.
    expect(withBundle!.totalMonthly - withoutBundle!.totalMonthly).toBe(55)
  })

  it('bundle necunoscut e ignorat silențios, nu aruncă', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const quote = await calculateSelfServeQuote({ ...baseInput, addons: [], bundle: 'does_not_exist' })
    expect(quote).not.toBeNull()
  })

  it('bundle selectat — onboardingPrice fix ÎNLOCUIEȘTE formula normală de onboarding (2026-08-20)', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)

    const quote = await calculateSelfServeQuote({ ...baseInput, addons: [], bundle: 'starter', includeOnboarding: true })
    // MINIMAL_CONFIG.bundles[0].onboardingPrice = 80.
    expect(quote?.onboardingTotal).toBe(80)
  })
})

describe('listSelfServeBundles', () => {
  it('array gol dacă platforma vanagreen nu e configurată', async () => {
    expect(await listSelfServeBundles()).toEqual([])
  })

  it('array gol dacă platforma există dar n-are pricing_config salvat', async () => {
    await makeVanagreenPlatform()
    expect(await listSelfServeBundles()).toEqual([])
  })

  it('întoarce catalogul de pachete al platformei configurate', async () => {
    const platform = await makeVanagreenPlatform()
    await upsertConfig(platform.id, MINIMAL_CONFIG)
    expect(await listSelfServeBundles()).toEqual(MINIMAL_CONFIG.bundles)
  })
})

describe('createSelfServeBillingClient', () => {
  it('creează un billing_client schelet cu needsBillingInfo=true, cif/address placeholder', async () => {
    const platform = await makeVanagreenPlatform()
    const tenantId = `qa-selfserve-${Date.now()}`
    const row = await createSelfServeBillingClient({
      vanagreenTenantId: tenantId,
      companyName: 'QA Self-Serve SRL',
      contactEmail: 'qa@example.com',
      quotedMonthlyTotal: 280,
      quotedAnnualTotal: 2800,
      needsBillingInfo: true,
      autoInvoiceEnabled: false,
    })
    clientIds.push(row.id)

    expect(row.name).toBe('QA Self-Serve SRL')
    expect(row.email).toBe('qa@example.com')
    expect(row.vanagreenTenantId).toBe(tenantId)
    expect(row.platformId).toBe(platform.id)
    expect(row.needsBillingInfo).toBe(true)
    expect(row.autoInvoiceEnabled).toBe(false)
    expect(row.cif).toBe('')
    expect(row.address).toBe('')
    expect(row.subscriptionPriceLei).toBe('280.00')
  })

  it('idempotent pe vanagreenTenantId — a doua chemare întoarce rândul existent, nu creează un al doilea', async () => {
    const tenantId = `qa-selfserve-idem-${Date.now()}`
    const payload = {
      vanagreenTenantId: tenantId,
      companyName: 'QA Idem SRL',
      contactEmail: 'idem@example.com',
      quotedMonthlyTotal: null,
      quotedAnnualTotal: null,
      needsBillingInfo: true as const,
      autoInvoiceEnabled: false as const,
    }
    const first = await createSelfServeBillingClient(payload)
    clientIds.push(first.id)
    const second = await createSelfServeBillingClient(payload)

    expect(second.id).toBe(first.id)
    const all = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, tenantId))
    expect(all).toHaveLength(1)
  })

  it('platformId rămâne null dacă platforma vanagreen nu e configurată', async () => {
    const tenantId = `qa-selfserve-noplatform-${Date.now()}`
    const row = await createSelfServeBillingClient({
      vanagreenTenantId: tenantId,
      companyName: 'QA No Platform SRL',
      contactEmail: 'noplat@example.com',
      quotedMonthlyTotal: null,
      quotedAnnualTotal: null,
      needsBillingInfo: true,
      autoInvoiceEnabled: false,
    })
    clientIds.push(row.id)
    expect(row.platformId).toBeNull()
  })
})
