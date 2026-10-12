/**
 * modules/reconciliation/vanagreen-extension.ts — cea mai critică bucată de logică
 * a Sprint C / Track B (vezi briefing QA). Integration test cu pg real (test/setup.ts,
 * pattern identic sequences.concurrency.test.ts / financials/service.test.ts).
 *
 * Mockuim doar connectors/vanagreen/billing.ts (network boundary) — restul (toggle,
 * idempotency, branching) rulează cu DB real, exact ca în producție.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import {
  billingClients,
  dashboardConfig,
  platforms,
  vanagreenExtensionLog,
} from '../../shared/db/schema/index.js'
import { encryptApiKey } from '../../shared/lib/crypto.js'

const fetchTenantsMock = vi.fn()
const fetchDemoTenantsMock = vi.fn()
const fetchInactiveTenantsMock = vi.fn()
const fetchTerminatedTenantsMock = vi.fn()
const pushLegalDetailsMock = vi.fn()
const pushBillingCycleMock = vi.fn()
const createTenantMock = vi.fn()
const extendMock = vi.fn()
const fetchReferralStatusMock = vi.fn()
const confirmReferralMock = vi.fn()

vi.mock('../../connectors/vanagreen/billing.js', () => ({
  fetchVanagreenTenants: (...args: unknown[]) => fetchTenantsMock(...args),
  fetchVanagreenDemoTenants: (...args: unknown[]) => fetchDemoTenantsMock(...args),
  fetchVanagreenInactiveTenants: (...args: unknown[]) => fetchInactiveTenantsMock(...args),
  fetchVanagreenTerminatedTenants: (...args: unknown[]) => fetchTerminatedTenantsMock(...args),
  pushVanagreenLegalDetails: (...args: unknown[]) => pushLegalDetailsMock(...args),
  pushVanagreenBillingCycle: (...args: unknown[]) => pushBillingCycleMock(...args),
  createVanagreenTenant: (...args: unknown[]) => createTenantMock(...args),
  extendVanagreenSubscription: (...args: unknown[]) => extendMock(...args),
  fetchReferralDiscountStatus: (...args: unknown[]) => fetchReferralStatusMock(...args),
  confirmReferralDiscount: (...args: unknown[]) => confirmReferralMock(...args),
}))

// Import DUPĂ vi.mock (hoisted oricum de vitest, dar păstrăm ordinea pt. claritate).
const {
  getVanagreenPlatformConfig,
  isAutoExtendEnabled,
  listVanagreenTenantsForMapping,
  maybeExtendSubscription,
  maybeGrantReferralDiscount,
  pushBillingCycleIfMapped,
  setAutoExtendEnabled,
  verifyVanagreenTenant,
} = await import('./vanagreen-extension.js')

const TOGGLE_KEY = 'vanagreen_auto_extend_enabled'
const clientIds: string[] = []
const platformIds: string[] = []

async function makeClient(overrides: Partial<typeof billingClients.$inferInsert> = {}) {
  const [row] = await db
    .insert(billingClients)
    .values({
      name: 'Test Client SRL',
      cif: 'RO999999',
      address: 'Str. Test 1',
      ...overrides,
    })
    .returning()
  clientIds.push(row!.id)
  return row!
}

async function makeVanagreenPlatform() {
  const [row] = await db
    .insert(platforms)
    .values({
      name: 'VanaGreen',
      type: 'vanagreen',
      apiUrl: 'https://vanagreen.example.com',
      apiKeyEnc: encryptApiKey('plain-test-key'),
    })
    .returning()
  platformIds.push(row!.id)
  return row!
}

beforeEach(async () => {
  fetchTenantsMock.mockReset()
  fetchDemoTenantsMock.mockReset()
  fetchDemoTenantsMock.mockResolvedValue([])
  fetchInactiveTenantsMock.mockReset()
  fetchInactiveTenantsMock.mockResolvedValue([])
  fetchTerminatedTenantsMock.mockReset()
  fetchTerminatedTenantsMock.mockResolvedValue([])
  pushLegalDetailsMock.mockReset()
  pushBillingCycleMock.mockReset()
  pushBillingCycleMock.mockResolvedValue({ ok: true, status: 200, tenantId: 'tenant-1' })
  createTenantMock.mockReset()
  extendMock.mockReset()
  extendMock.mockResolvedValue({ ok: true, status: 200, tenantId: 'tenant-1' })
  fetchReferralStatusMock.mockReset()
  fetchReferralStatusMock.mockResolvedValue({ ok: true, status: 200, data: { eligible: false, referralId: null, referrerTenantId: null } })
  confirmReferralMock.mockReset()
  confirmReferralMock.mockResolvedValue({ ok: true, status: 200, alreadyApplied: false })
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
})

afterEach(async () => {
  if (platformIds.length) {
    await db.delete(platforms).where(inArray(platforms.id, platformIds.splice(0)))
  }
})

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
  if (clientIds.length) {
    await db.delete(vanagreenExtensionLog).where(inArray(vanagreenExtensionLog.billingClientId, clientIds))
    await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
  }
})

describe('isAutoExtendEnabled / setAutoExtendEnabled', () => {
  it('defaults to false when no row exists in dashboard_config', async () => {
    expect(await isAutoExtendEnabled()).toBe(false)
  })

  it('round-trips true/false through the toggle', async () => {
    await setAutoExtendEnabled(true)
    expect(await isAutoExtendEnabled()).toBe(true)
    await setAutoExtendEnabled(false)
    expect(await isAutoExtendEnabled()).toBe(false)
  })

  it('upserts (does not duplicate) the config row on repeated writes', async () => {
    await setAutoExtendEnabled(true)
    await setAutoExtendEnabled(false)
    await setAutoExtendEnabled(true)
    const rows = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toBe(true)
  })
})

describe('getVanagreenPlatformConfig', () => {
  it('returns null when the vanagreen platform is not configured', async () => {
    expect(await getVanagreenPlatformConfig()).toBeNull()
  })

  it('returns the decrypted config when the platform exists', async () => {
    await makeVanagreenPlatform()
    const config = await getVanagreenPlatformConfig()
    expect(config).not.toBeNull()
    expect(config?.apiKey).toBe('plain-test-key')
    expect(config?.type).toBe('vanagreen')
  })

  it('ignores a soft-deleted vanagreen platform (regression: bug găsit la QA Sprint 2/3/4, 2026-07-24 — lipsea filtrul deletedAt)', async () => {
    const platform = await makeVanagreenPlatform()
    await db.update(platforms).set({ deletedAt: new Date() }).where(eq(platforms.id, platform.id))

    expect(await getVanagreenPlatformConfig()).toBeNull()
  })
})

describe('listVanagreenTenantsForMapping / verifyVanagreenTenant', () => {
  it('returns [] when the platform is not configured (no fetch attempted)', async () => {
    expect(await listVanagreenTenantsForMapping()).toEqual([])
    expect(fetchTenantsMock).not.toHaveBeenCalled()
  })

  it('returns false from verifyVanagreenTenant when the platform is not configured', async () => {
    expect(await verifyVanagreenTenant('tenant-1')).toBe(false)
  })

  it('verifyVanagreenTenant returns false (not a throw) when every fetch fails', async () => {
    await makeVanagreenPlatform()
    fetchTenantsMock.mockRejectedValue(new Error('network down'))
    fetchDemoTenantsMock.mockRejectedValue(new Error('network down'))
    fetchInactiveTenantsMock.mockRejectedValue(new Error('network down'))
    fetchTerminatedTenantsMock.mockRejectedValue(new Error('network down'))
    await expect(verifyVanagreenTenant('tenant-1')).resolves.toBe(false)
  })

  it('verifyVanagreenTenant finds a tenant present only in the ACTIVE list', async () => {
    await makeVanagreenPlatform()
    fetchTenantsMock.mockResolvedValue([{ id: 'tenant-1', name: 'Activ SRL' }])
    await expect(verifyVanagreenTenant('tenant-1')).resolves.toBe(true)
  })

  // Regression (2026-09-21, Stefan): verifyVanagreenTenant verifica DOAR lista activă —
  // un tenant demo/inactiv/reziliat exista în vanagreen dar era raportat ca inexistent.
  it('verifyVanagreenTenant finds a tenant present only in the DEMO list', async () => {
    await makeVanagreenPlatform()
    fetchTenantsMock.mockResolvedValue([])
    fetchDemoTenantsMock.mockResolvedValue([{ id: 'tenant-demo-1', name: 'Demo SRL' }])
    await expect(verifyVanagreenTenant('tenant-demo-1')).resolves.toBe(true)
  })

  it('verifyVanagreenTenant finds a tenant present only in the INACTIVE list', async () => {
    await makeVanagreenPlatform()
    fetchTenantsMock.mockResolvedValue([])
    fetchInactiveTenantsMock.mockResolvedValue([{ id: 'tenant-inactive-1', name: 'Inactiv SRL' }])
    await expect(verifyVanagreenTenant('tenant-inactive-1')).resolves.toBe(true)
  })

  it('verifyVanagreenTenant finds a tenant present only in the TERMINATED list', async () => {
    await makeVanagreenPlatform()
    fetchTenantsMock.mockResolvedValue([])
    fetchTerminatedTenantsMock.mockResolvedValue([{ id: 'tenant-terminated-1', name: 'Reziliat SRL' }])
    await expect(verifyVanagreenTenant('tenant-terminated-1')).resolves.toBe(true)
  })

  it('verifyVanagreenTenant returns false when one list fails but the tenant is not in the others (isolated failure)', async () => {
    await makeVanagreenPlatform()
    fetchTenantsMock.mockResolvedValue([])
    fetchDemoTenantsMock.mockRejectedValue(new Error('network down'))
    await expect(verifyVanagreenTenant('tenant-x')).resolves.toBe(false)
  })
})

describe('maybeExtendSubscription — branching (Sprint C, Track D: bump local, fără apel cross-repo)', () => {
  it('no-op when billingClientId is null (no throw, no log row)', async () => {
    await expect(maybeExtendSubscription({ billingClientId: null, source: 'mark_paid', sourceId: 'x-1' })).resolves.toBeUndefined()
  })

  it('no-op when the client has no vanagreenTenantId', async () => {
    const client = await makeClient({ vanagreenTenantId: null, vanagreenExtendMonths: 3 })
    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId: `x-${client.id}` })
    const logs = await db.select().from(vanagreenExtensionLog).where(eq(vanagreenExtensionLog.billingClientId, client.id))
    expect(logs).toHaveLength(0)
  })

  it('no-op when the client has no vanagreenExtendMonths', async () => {
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: null })
    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId: `x-${client.id}` })
    const logs = await db.select().from(vanagreenExtensionLog).where(eq(vanagreenExtensionLog.billingClientId, client.id))
    expect(logs).toHaveLength(0)
  })

  it('toggle OFF -> writes a dry_run/success log, billingDueDate NOT touched', async () => {
    await setAutoExtendEnabled(false)
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 3, billingDueDate: '2026-01-01' })
    const sourceId = `x-${client.id}`
    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })

    const [log] = await db
      .select()
      .from(vanagreenExtensionLog)
      .where(and(eq(vanagreenExtensionLog.source, 'mark_paid'), eq(vanagreenExtensionLog.sourceId, sourceId)))
    expect(log?.mode).toBe('dry_run')
    expect(log?.status).toBe('success')
    expect(log?.months).toBe(3)
    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.billingDueDate).toBe('2026-01-01')
  })

  it('toggle ON -> bumps billingDueDate locally by vanagreenExtendMonths, resets reminder timestamps, live/success log — bump itself needs no platform config', async () => {
    await setAutoExtendEnabled(true)
    // Deliberat NU makeVanagreenPlatform() — bump-ul e local, nu mai depinde de config
    // platformă (fire-and-forget-ul de clear is_demo sare peste, dar bump-ul tot reușește).
    const client = await makeClient({
      vanagreenTenantId: 'tenant-1',
      vanagreenExtendMonths: 6,
      billingDueDate: '2026-01-15',
      billingReminder7dSentAt: new Date(),
      billingOverdueSentAt: new Date(),
    })
    const sourceId = `x-${client.id}`

    await maybeExtendSubscription({ billingClientId: client.id, source: 'auto_match', sourceId })

    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.billingDueDate).toBe('2026-07-15')
    expect(updated?.billingReminder7dSentAt).toBeNull()
    expect(updated?.billingOverdueSentAt).toBeNull()
    expect(extendMock).not.toHaveBeenCalled() // fără platformă configurată, nici nu încearcă

    const [log] = await db
      .select()
      .from(vanagreenExtensionLog)
      .where(and(eq(vanagreenExtensionLog.source, 'auto_match'), eq(vanagreenExtensionLog.sourceId, sourceId)))
    expect(log?.mode).toBe('live')
    expect(log?.status).toBe('success')
  })

  it('toggle ON + platform configured -> ALSO calls extendVanagreenSubscription fire-and-forget, passing the LOCALLY-computed nextDueDate explicitly (wave 6 — vanagreen no longer recomputes it)', async () => {
    await setAutoExtendEnabled(true)
    await makeVanagreenPlatform()
    extendMock.mockResolvedValue({ ok: true, status: 200, tenantId: 'tenant-1' })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 3, billingDueDate: '2026-01-01' })
    const sourceId = `x-${client.id}`

    await maybeExtendSubscription({ billingClientId: client.id, source: 'auto_match', sourceId })

    expect(extendMock).toHaveBeenCalledTimes(1)
    expect(extendMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'plain-test-key' }), 'tenant-1', 3, sourceId, '2026-04-01')
    // Data locală vine din calculul local, NU din răspunsul mock-uit al connectorului.
    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.billingDueDate).toBe('2026-04-01')
  })

  it('toggle ON + platform configured + extendVanagreenSubscription fails -> local bump/log stay success (isolated failure, not surfaced to caller)', async () => {
    await setAutoExtendEnabled(true)
    await makeVanagreenPlatform()
    extendMock.mockResolvedValue({ ok: false, status: 500, tenantId: 'tenant-1', message: 'vanagreen 500' })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 3, billingDueDate: '2026-01-01' })
    const sourceId = `x-${client.id}`

    await expect(maybeExtendSubscription({ billingClientId: client.id, source: 'auto_match', sourceId })).resolves.toBeUndefined()

    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.billingDueDate).toBe('2026-04-01') // bump-ul local tot a reușit

    const [log] = await db
      .select()
      .from(vanagreenExtensionLog)
      .where(and(eq(vanagreenExtensionLog.source, 'auto_match'), eq(vanagreenExtensionLog.sourceId, sourceId)))
    expect(log?.status).toBe('success') // eșecul apelului secundar nu răstoarnă statusul bump-ului local
  })

  it('toggle ON + billingDueDate null -> extends from today (not a throw)', async () => {
    await setAutoExtendEnabled(true)
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 1, billingDueDate: null })
    const sourceId = `x-${client.id}`

    await expect(maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })).resolves.toBeUndefined()
    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.billingDueDate).not.toBeNull()
  })
})

describe('maybeExtendSubscription — idempotency (sequential retry)', () => {
  it('a second call with the same (source, sourceId) is a no-op: single log row, billingDueDate bumped only once', async () => {
    await setAutoExtendEnabled(true)
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 2, billingDueDate: '2026-01-01' })
    const sourceId = `retry-${client.id}`

    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })
    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })

    const logs = await db
      .select()
      .from(vanagreenExtensionLog)
      .where(and(eq(vanagreenExtensionLog.source, 'mark_paid'), eq(vanagreenExtensionLog.sourceId, sourceId)))
    expect(logs).toHaveLength(1)
    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.billingDueDate).toBe('2026-03-01') // +2 luni O SINGURĂ dată, nu +4
  })

  it('idempotency holds for dry-run too: retry does not write a second dry_run log', async () => {
    await setAutoExtendEnabled(false)
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 2 })
    const sourceId = `retry-dry-${client.id}`

    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })
    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })

    const logs = await db
      .select()
      .from(vanagreenExtensionLog)
      .where(and(eq(vanagreenExtensionLog.source, 'mark_paid'), eq(vanagreenExtensionLog.sourceId, sourceId)))
    expect(logs).toHaveLength(1)
  })
})

describe('maybeExtendSubscription — concurrent calls with the SAME (source, sourceId) (mandatory concurrency test)', () => {
  it('BUG-QA-VGX-1 (fixat, tot valabil pt. bump local): N concurrent racers on an identical sourceId extend exactly once — atomic INSERT ... ON CONFLICT DO NOTHING claims the slot, no rejections, no double-extend', async () => {
    await setAutoExtendEnabled(true)
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 4, billingDueDate: '2026-01-01' })
    const sourceId = `race-${client.id}`

    const N = 5
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => maybeExtendSubscription({ billingClientId: client.id, source: 'auto_match', sourceId })),
    )

    // Fixat: insert-ul atomic (ON CONFLICT DO NOTHING) pe (source, sourceId) decide un
    // singur câștigător — restul văd conflictul direct din DB, fără nicio excepție
    // aruncată către apelant.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    const logs = await db
      .select()
      .from(vanagreenExtensionLog)
      .where(and(eq(vanagreenExtensionLog.source, 'auto_match'), eq(vanagreenExtensionLog.sourceId, sourceId)))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.status).toBe('success')

    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.billingDueDate).toBe('2026-05-01') // +4 luni O SINGURĂ dată, nu ×5
  })
})

describe('pushBillingCycleIfMapped (Sprint C, Track D, wave 6)', () => {
  it('no-op silențios dacă clientul nu e mapat la vanagreen', async () => {
    const client = await makeClient({ vanagreenTenantId: null })
    await expect(pushBillingCycleIfMapped(client)).resolves.toBeUndefined()
    expect(pushBillingCycleMock).not.toHaveBeenCalled()
  })

  it('no-op (doar log) dacă platforma vanagreen nu e configurată', async () => {
    const client = await makeClient({ vanagreenTenantId: 'tenant-1' })
    await expect(pushBillingCycleIfMapped(client)).resolves.toBeUndefined()
    expect(pushBillingCycleMock).not.toHaveBeenCalled()
  })

  it('client mapat + platformă configurată -> push cu billingDueDate/billingCycle/day/month curente', async () => {
    await makeVanagreenPlatform()
    const client = await makeClient({
      vanagreenTenantId: 'tenant-1',
      billingDueDate: '2026-08-01',
      billingCycle: 'monthly',
      billingCycleDay: 1,
    })

    await pushBillingCycleIfMapped(client)

    expect(pushBillingCycleMock).toHaveBeenCalledTimes(1)
    expect(pushBillingCycleMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'plain-test-key' }), 'tenant-1', {
      billingDueDate: '2026-08-01',
      billingCycle: 'monthly',
      billingCycleDay: 1,
      billingCycleMonth: null,
    })
  })

  it('eșecul push-ului nu aruncă (izolat, doar log)', async () => {
    await makeVanagreenPlatform()
    pushBillingCycleMock.mockResolvedValue({ ok: false, status: 500, tenantId: 'tenant-1', message: 'vanagreen 500' })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', billingDueDate: '2026-08-01' })

    await expect(pushBillingCycleIfMapped(client)).resolves.toBeUndefined()
  })
})

describe('maybeGrantReferralDiscount (sprint Referral discount status, 2026-08-12)', () => {
  it('not eligible -> no-op, nicio scriere, confirm neapelat', async () => {
    const config = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKey: 'k' }
    fetchReferralStatusMock.mockResolvedValue({ ok: true, status: 200, data: { eligible: false, referralId: null, referrerTenantId: null } })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', subscriptionPriceLei: '100' })

    await expect(maybeGrantReferralDiscount(config, client)).resolves.toBeUndefined()

    expect(confirmReferralMock).not.toHaveBeenCalled()
    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.referralDiscountPendingAmount).toBeNull()
  })

  it('status fetch eșuat (!ok) -> no-op, doar log, confirm neapelat', async () => {
    const config = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKey: 'k' }
    fetchReferralStatusMock.mockResolvedValue({ ok: false, status: 500, message: 'boom' })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', subscriptionPriceLei: '100' })

    await expect(maybeGrantReferralDiscount(config, client)).resolves.toBeUndefined()
    expect(confirmReferralMock).not.toHaveBeenCalled()
  })

  it('eligible:true dar referralId/referrerTenantId null (stare inconsistentă) -> log, no-op, confirm neapelat', async () => {
    const config = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKey: 'k' }
    fetchReferralStatusMock.mockResolvedValue({ ok: true, status: 200, data: { eligible: true, referralId: null, referrerTenantId: null } })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', subscriptionPriceLei: '100' })

    await expect(maybeGrantReferralDiscount(config, client)).resolves.toBeUndefined()
    expect(confirmReferralMock).not.toHaveBeenCalled()
  })

  it('referrer nemapat la niciun billing_client -> self-heal (return fără confirm, nu rescrie eligible)', async () => {
    const config = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKey: 'k' }
    fetchReferralStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { eligible: true, referralId: 'ref-1', referrerTenantId: 'tenant-unmapped' },
    })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', subscriptionPriceLei: '100' })

    await expect(maybeGrantReferralDiscount(config, client)).resolves.toBeUndefined()

    expect(confirmReferralMock).not.toHaveBeenCalled()
    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.referralDiscountPendingAmount).toBeNull()
  })

  it('clientul adus nu are preț de abonament setat -> log, no-op, confirm neapelat', async () => {
    const config = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKey: 'k' }
    const referrer = await makeClient({ vanagreenTenantId: 'tenant-referrer-noprice' })
    fetchReferralStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { eligible: true, referralId: 'ref-1', referrerTenantId: 'tenant-referrer-noprice' },
    })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', subscriptionPriceLei: null })
    void referrer

    await expect(maybeGrantReferralDiscount(config, client)).resolves.toBeUndefined()
    expect(confirmReferralMock).not.toHaveBeenCalled()
  })

  it('discount calculat corect (30% din prețul clientului adus) — scris pe AMBELE rânduri cu aceeași sumă+monedă, apoi confirm', async () => {
    const config = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKey: 'k' }
    const referrer = await makeClient({ vanagreenTenantId: 'tenant-referrer-ok', subscriptionPriceLei: '50' })
    fetchReferralStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { eligible: true, referralId: 'ref-1', referrerTenantId: 'tenant-referrer-ok' },
    })
    confirmReferralMock.mockResolvedValue({ ok: true, status: 200, alreadyApplied: false })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', subscriptionPriceLei: '299.99', subscriptionPriceCurrency: 'lei' })

    await maybeGrantReferralDiscount(config, client)

    expect(confirmReferralMock).toHaveBeenCalledTimes(1)
    expect(confirmReferralMock).toHaveBeenCalledWith(config, 'tenant-1', 'ref-1')

    const [updatedClient] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    const [updatedReferrer] = await db.select().from(billingClients).where(eq(billingClients.id, referrer.id))
    expect(updatedClient?.referralDiscountReferralId).toBe('ref-1')
    expect(updatedClient?.referralDiscountPendingAmount).toBe('90.00')
    expect(updatedClient?.referralDiscountPendingCurrency).toBe('lei')
    expect(updatedReferrer?.referralDiscountReferralId).toBe('ref-1')
    expect(updatedReferrer?.referralDiscountPendingAmount).toBe('90.00')
    expect(updatedReferrer?.referralDiscountPendingCurrency).toBe('lei')
  })

  it('confirm eșuat -> NU rollback pe pending discount deja scris, doar log', async () => {
    const config = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://vanagreen.example.com', apiKey: 'k' }
    await makeClient({ vanagreenTenantId: 'tenant-referrer-confirmfail', subscriptionPriceLei: '50' })
    fetchReferralStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { eligible: true, referralId: 'ref-1', referrerTenantId: 'tenant-referrer-confirmfail' },
    })
    confirmReferralMock.mockResolvedValue({ ok: false, status: 500, message: 'vanagreen 500' })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', subscriptionPriceLei: '100' })

    await expect(maybeGrantReferralDiscount(config, client)).resolves.toBeUndefined()

    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updated?.referralDiscountReferralId).toBe('ref-1')
    expect(updated?.referralDiscountPendingAmount).toBe('30.00')
  })

  it('dry-run (toggle OFF) nu declanșează hook-ul — fetchReferralDiscountStatus neapelat', async () => {
    await setAutoExtendEnabled(false)
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 3, subscriptionPriceLei: '100' })
    const sourceId = `referral-dry-${client.id}`

    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })

    expect(fetchReferralStatusMock).not.toHaveBeenCalled()
  })

  it('calea live + platformă configurată -> maybeExtendSubscription declanșează hook-ul (fetchReferralDiscountStatus apelat)', async () => {
    await setAutoExtendEnabled(true)
    await makeVanagreenPlatform()
    fetchReferralStatusMock.mockResolvedValue({ ok: true, status: 200, data: { eligible: false, referralId: null, referrerTenantId: null } })
    const client = await makeClient({ vanagreenTenantId: 'tenant-1', vanagreenExtendMonths: 3, billingDueDate: '2026-01-01' })
    const sourceId = `referral-live-${client.id}`

    await maybeExtendSubscription({ billingClientId: client.id, source: 'mark_paid', sourceId })

    expect(fetchReferralStatusMock).toHaveBeenCalledTimes(1)
    expect(fetchReferralStatusMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'plain-test-key' }), 'tenant-1')
  })
})
