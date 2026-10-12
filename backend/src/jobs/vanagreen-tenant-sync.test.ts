/**
 * jobs/vanagreen-tenant-sync.ts — Sprint C, Track D: creare automată de billing_clients
 * "schelet" pt. tenants vanagreen nemapați. Integration test, pg real; connector + config
 * platformă mockuite la graniță.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { billingClients } from '../shared/db/schema/index.js'

const fetchTenantsMock = vi.fn()
const fetchDemoTenantsMock = vi.fn()
const fetchInactiveTenantsMock = vi.fn()
const fetchTerminatedTenantsMock = vi.fn()
const getConfigMock = vi.fn()
const pushBillingCycleMock = vi.fn()

vi.mock('../connectors/vanagreen/billing.js', () => ({
  fetchVanagreenTenants: (...args: unknown[]) => fetchTenantsMock(...args),
  fetchVanagreenDemoTenants: (...args: unknown[]) => fetchDemoTenantsMock(...args),
  fetchVanagreenInactiveTenants: (...args: unknown[]) => fetchInactiveTenantsMock(...args),
  fetchVanagreenTerminatedTenants: (...args: unknown[]) => fetchTerminatedTenantsMock(...args),
  pushVanagreenBillingCycle: (...args: unknown[]) => pushBillingCycleMock(...args),
}))
vi.mock('../modules/reconciliation/vanagreen-extension.js', () => ({
  getVanagreenPlatformConfig: (...args: unknown[]) => getConfigMock(...args),
}))

const { runVanagreenTenantSyncJob } = await import('./vanagreen-tenant-sync.js')

const FAKE_CONFIG = { id: 'p1', name: 'VanaGreen', type: 'vanagreen', apiUrl: 'https://x', apiKey: 'k' }
const clientIds: string[] = []

function fakeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    name: 'Tenant Nou SRL',
    slug: 'tenant-nou',
    cif: null,
    registryNumber: null,
    address: null,
    city: null,
    county: null,
    billingDueDate: null,
    billingCycle: null,
    billingCycleDay: null,
    billingCycleMonth: null,
    ...overrides,
  }
}

function fakeDemoTenant(overrides: Record<string, unknown> = {}) {
  return { ...fakeTenant(overrides), createdAt: '2026-08-01T00:00:00.000Z', demoEndsAt: null, ...overrides }
}

async function cleanupByVanagreenId(id: string) {
  const rows = await db.select({ id: billingClients.id }).from(billingClients).where(eq(billingClients.vanagreenTenantId, id))
  for (const r of rows) clientIds.push(r.id)
}

beforeEach(() => {
  fetchTenantsMock.mockReset()
  fetchDemoTenantsMock.mockReset()
  fetchDemoTenantsMock.mockResolvedValue([])
  fetchInactiveTenantsMock.mockReset()
  fetchInactiveTenantsMock.mockResolvedValue([])
  fetchTerminatedTenantsMock.mockReset()
  fetchTerminatedTenantsMock.mockResolvedValue([])
  getConfigMock.mockReset()
  getConfigMock.mockResolvedValue(FAKE_CONFIG)
  pushBillingCycleMock.mockReset()
  pushBillingCycleMock.mockResolvedValue({ ok: true, status: 200, tenantId: 'tenant-1' })
})

afterEach(async () => {
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
})

afterAll(() => vi.restoreAllMocks())

describe('runVanagreenTenantSyncJob', () => {
  it('does nothing when the vanagreen platform is not configured', async () => {
    getConfigMock.mockResolvedValue(null)
    await runVanagreenTenantSyncJob()
    expect(fetchTenantsMock).not.toHaveBeenCalled()
  })

  it('does nothing when fetch fails (does not throw)', async () => {
    fetchTenantsMock.mockRejectedValue(new Error('vanagreen down'))
    await expect(runVanagreenTenantSyncJob()).resolves.not.toThrow()
  })

  it('creates a skeleton billing_client for a tenant with no existing mapping', async () => {
    fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-new-1', name: 'Fresh Tenant SRL', slug: 'fresh-tenant' })])

    await runVanagreenTenantSyncJob()
    await cleanupByVanagreenId('tenant-new-1')

    const [row] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-new-1'))
    expect(row).toBeDefined()
    expect(row?.name).toBe('Fresh Tenant SRL')
    expect(row?.slug).toBe('fresh-tenant')
    expect(row?.needsBillingInfo).toBe(true)
    expect(row?.cif).toBe('')
  })

  it('does NOT create a duplicate for a tenant already mapped (match strict on vanagreenTenantId)', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Already Mapped SRL', cif: 'RO123', address: 'x', vanagreenTenantId: 'tenant-existing-1' })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-existing-1', name: 'Already Mapped SRL (renamed in vanagreen)' })])
    await runVanagreenTenantSyncJob()

    const rows = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-existing-1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(existing!.id)
  })

  describe('identitate (name/slug) — reconciliere zilnică (2026-08-19, bug Stefan: redenumire în vanagreen nu ajungea în vana-dash)', () => {
    it('resincronizează name/slug pt. un client deja mapat, când vanagreen arată altă valoare', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Nume Vechi SRL', slug: 'nume-vechi', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-renamed' })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-renamed', name: 'Nume Nou SRL', slug: 'nume-nou' })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.name).toBe('Nume Nou SRL')
      expect(row?.slug).toBe('nume-nou')
    })

    it('nu atinge name/slug când sunt deja identice (fără UPDATE inutil)', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Stable SRL', slug: 'stable', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-stable' })
        .returning()
      clientIds.push(existing!.id)
      const updatedAtBefore = existing!.updatedAt

      fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-stable', name: 'Stable SRL', slug: 'stable' })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.updatedAt).toEqual(updatedAtBefore)
    })

    it('resincronizează name/slug și pt. tenanți demo/inactivi mapați, nu doar pt. cei reali', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Demo Vechi SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-demo-renamed', isDemo: true })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([])
      fetchDemoTenantsMock.mockResolvedValue([fakeDemoTenant({ id: 'tenant-demo-renamed', name: 'Demo Nou SRL' })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.name).toBe('Demo Nou SRL')
    })
  })

  it('CRITICAL — per-tenant error isolation: a duplicate-slug failure on one tenant does not stop the rest of the batch', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Slug Clash SRL', slug: 'slug-clash', cif: 'RO1', address: 'x' })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([
      fakeTenant({ id: 'tenant-clash', name: 'Slug Clash SRL', slug: 'slug-clash' }), // conflict pe unique(slug)
      fakeTenant({ id: 'tenant-ok', name: 'OK Tenant SRL', slug: 'ok-tenant' }),
    ])

    await expect(runVanagreenTenantSyncJob()).resolves.not.toThrow()
    await cleanupByVanagreenId('tenant-ok')

    const [okRow] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-ok'))
    expect(okRow).toBeDefined() // al doilea tenant tot a fost creat, deși primul a picat

    const clashRows = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-clash'))
    expect(clashRows).toHaveLength(0) // primul n-a fost creat (slug ocupat), dar nu a blocat restul
  })

  it('processes multiple new tenants in one run, skipping only the already-mapped ones', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Old SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-old' })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([
      fakeTenant({ id: 'tenant-old', name: 'Old SRL' }),
      fakeTenant({ id: 'tenant-new-a', name: 'New A SRL', slug: 'new-a' }),
      fakeTenant({ id: 'tenant-new-b', name: 'New B SRL', slug: 'new-b' }),
    ])

    await runVanagreenTenantSyncJob()
    await cleanupByVanagreenId('tenant-new-a')
    await cleanupByVanagreenId('tenant-new-b')

    const newRows = await db
      .select()
      .from(billingClients)
      .where(and(inArray(billingClients.vanagreenTenantId, ['tenant-new-a', 'tenant-new-b']), isNull(billingClients.deletedAt)))
    expect(newRows).toHaveLength(2)
  })

  it('creates an isDemo:true skeleton with demoEndsAt for an unmapped demo tenant', async () => {
    fetchTenantsMock.mockResolvedValue([])
    fetchDemoTenantsMock.mockResolvedValue([
      fakeDemoTenant({ id: 'tenant-demo-1', name: 'Demo Tenant SRL', slug: 'demo-tenant', demoEndsAt: '2026-09-01' }),
    ])

    await runVanagreenTenantSyncJob()
    await cleanupByVanagreenId('tenant-demo-1')

    const [row] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-demo-1'))
    expect(row).toBeDefined()
    expect(row?.isDemo).toBe(true)
    expect(row?.needsBillingInfo).toBe(true)
    expect(row?.demoEndsAt).toBe('2026-09-01')
    expect(row?.cif).toBe('')
  })

  it('does NOT create a duplicate for a demo tenant already mapped', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Already Demo SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-demo-existing', isDemo: true })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([])
    fetchDemoTenantsMock.mockResolvedValue([fakeDemoTenant({ id: 'tenant-demo-existing' })])
    await runVanagreenTenantSyncJob()

    const rows = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-demo-existing'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(existing!.id)
    expect(rows[0]?.isDemo).toBe(true) // neatins — apare tot în lista demo, nu s-a convertit
  })

  it('flips isDemo→false when a previously-demo client now appears in the NON-demo tenants list (conversie detectată)', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Converted SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-converted', isDemo: true })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-converted', name: 'Converted SRL' })])
    fetchDemoTenantsMock.mockResolvedValue([]) // nu mai apare aici — vanagreen l-a scos din demo
    await runVanagreenTenantSyncJob()

    const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
    expect(row?.isDemo).toBe(false)
  })

  it('flips isDemo→true when a previously-real client now appears in the DEMO tenants list (bug found 2026-08-11)', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Borealis Metal SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-turned-demo' })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([]) // nu mai apare aici — vanagreen l-a marcat demo
    fetchDemoTenantsMock.mockResolvedValue([fakeDemoTenant({ id: 'tenant-turned-demo', demoEndsAt: '2026-09-01' })])
    await runVanagreenTenantSyncJob()

    const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
    expect(row?.isDemo).toBe(true)
    expect(row?.demoEndsAt).toBe('2026-09-01')
  })

  it('leaves isDemo=false untouched for an already-mapped non-demo client', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Always Real SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-real' })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-real', name: 'Always Real SRL' })])
    await runVanagreenTenantSyncJob()

    const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
    expect(row?.isDemo).toBe(false)
  })

  it('BUG-VGX-DUEDATE — re-pushes billingDueDate/cycle when vanagreen mirror has drifted from the local (source of truth) value', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({
        name: 'Acme Recycling SRL',
        cif: 'RO1',
        address: 'x',
        vanagreenTenantId: 'tenant-drifted',
        billingDueDate: '2026-09-01',
        billingCycle: 'monthly',
        billingCycleDay: 1,
      })
      .returning()
    clientIds.push(existing!.id)

    // vanagreen încă are data veche — push-ul fire-and-forget de la plata anterioară a eșuat.
    fetchTenantsMock.mockResolvedValue([
      fakeTenant({
        id: 'tenant-drifted',
        name: 'Acme Recycling SRL',
        billingDueDate: '2026-08-01',
        billingCycle: 'monthly',
        billingCycleDay: 1,
      }),
    ])

    await runVanagreenTenantSyncJob()

    expect(pushBillingCycleMock).toHaveBeenCalledWith(FAKE_CONFIG, 'tenant-drifted', {
      billingDueDate: '2026-09-01',
      billingCycle: 'monthly',
      billingCycleDay: 1,
      billingCycleMonth: null,
    })
  })

  it('does NOT re-push billing-cycle when vanagreen mirror already matches local (no drift)', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({
        name: 'In Sync SRL',
        cif: 'RO1',
        address: 'x',
        vanagreenTenantId: 'tenant-in-sync',
        billingDueDate: '2026-09-01',
        billingCycle: 'monthly',
        billingCycleDay: 1,
      })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([
      fakeTenant({ id: 'tenant-in-sync', name: 'In Sync SRL', billingDueDate: '2026-09-01', billingCycle: 'monthly', billingCycleDay: 1 }),
    ])

    await runVanagreenTenantSyncJob()

    expect(pushBillingCycleMock).not.toHaveBeenCalled()
  })

  it('does NOT re-push billing-cycle for a mapped client with no local billingDueDate set yet (nothing to push)', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'No Cadence Yet SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-no-cadence' })
      .returning()
    clientIds.push(existing!.id)

    fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-no-cadence', name: 'No Cadence Yet SRL', billingDueDate: '2026-01-01' })])

    await runVanagreenTenantSyncJob()

    expect(pushBillingCycleMock).not.toHaveBeenCalled()
  })

  it('a re-push failure is isolated (logged, does not throw, does not stop the rest of the batch)', async () => {
    const [existing] = await db
      .insert(billingClients)
      .values({ name: 'Drift Push Fails SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-drift-fails', billingDueDate: '2026-09-01' })
      .returning()
    clientIds.push(existing!.id)

    pushBillingCycleMock.mockResolvedValue({ ok: false, status: 500, tenantId: 'tenant-drift-fails', message: 'vanagreen down' })
    fetchTenantsMock.mockResolvedValue([
      fakeTenant({ id: 'tenant-drift-fails', name: 'Drift Push Fails SRL', billingDueDate: '2026-08-01' }),
      fakeTenant({ id: 'tenant-ok-after-drift', name: 'OK After Drift SRL', slug: 'ok-after-drift' }),
    ])

    await expect(runVanagreenTenantSyncJob()).resolves.not.toThrow()
    await cleanupByVanagreenId('tenant-ok-after-drift')

    const [okRow] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-ok-after-drift'))
    expect(okRow).toBeDefined()
  })

  it('a demo-fetch failure does not stop the real-tenant sync (isolated try/catch)', async () => {
    fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-real-ok', name: 'Real OK SRL', slug: 'real-ok' })])
    fetchDemoTenantsMock.mockRejectedValue(new Error('vanagreen demo endpoint down'))

    await expect(runVanagreenTenantSyncJob()).resolves.not.toThrow()
    await cleanupByVanagreenId('tenant-real-ok')

    const [row] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-real-ok'))
    expect(row).toBeDefined()
  })

  describe('inactive tenants (2026-08-11 — treated as demo, Stefan: "inactivi pot fi tot demo")', () => {
    it('creates an isDemo:true skeleton for an unmapped inactive tenant', async () => {
      fetchTenantsMock.mockResolvedValue([])
      fetchInactiveTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-inactive-1', name: 'Inactive Tenant SRL', slug: 'inactive-tenant' })])

      await runVanagreenTenantSyncJob()
      await cleanupByVanagreenId('tenant-inactive-1')

      const [row] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-inactive-1'))
      expect(row).toBeDefined()
      expect(row?.isDemo).toBe(true)
      expect(row?.needsBillingInfo).toBe(true)
    })

    it('flips isDemo→true for an already-mapped non-demo client that now appears as inactive', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Went Inactive SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-went-inactive' })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([])
      fetchInactiveTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-went-inactive' })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.isDemo).toBe(true)
    })

    it('leaves an already-demo mapped client untouched (no duplicate, no error)', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Already Demo Inactive SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-demo-inactive', isDemo: true })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([])
      fetchInactiveTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-demo-inactive' })])
      await runVanagreenTenantSyncJob()

      const rows = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-demo-inactive'))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(existing!.id)
    })
  })

  describe('terminated tenants — "în ștergere" (2026-08-11, bug Stefan — Testing SIGNUP)', () => {
    it('marks a mapped client pendingDeletionAt = the deleted_at timestamp from vanagreen', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Testing SIGNUP', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-terminated-1' })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([])
      // Relativ la acum, nu dată fixă — peste 30 zile ar prinde-o purjarea din aceeași rulare.
      const deletedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      fetchTerminatedTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-terminated-1', deletedAt })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.pendingDeletionAt?.toISOString()).toBe(deletedAt)
      expect(row?.deletedAt).toBeNull() // NU soft-deletat imediat — doar marcat, purjarea e separată
    })

    it('does NOT create a skeleton for an unmapped terminated tenant (nothing to bill)', async () => {
      fetchTenantsMock.mockResolvedValue([])
      fetchTerminatedTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-terminated-unmapped', deletedAt: '2026-08-05T00:00:00.000Z' })])
      await runVanagreenTenantSyncJob()

      const rows = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-terminated-unmapped'))
      expect(rows).toHaveLength(0)
    })

    it('does NOT overwrite an already-set pendingDeletionAt (idempotent — stays pinned to the first-seen value)', async () => {
      const firstSeen = new Date('2026-08-01T00:00:00.000Z')
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Already Marked SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-already-marked', pendingDeletionAt: firstSeen })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([])
      fetchTerminatedTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-already-marked', deletedAt: '2026-08-10T00:00:00.000Z' })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.pendingDeletionAt?.toISOString()).toBe(firstSeen.toISOString())
    })

    it('clears pendingDeletionAt when a marked client is restored (reappears in the real tenants list)', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({
          name: 'Restored SRL',
          cif: 'RO1',
          address: 'x',
          vanagreenTenantId: 'tenant-restored',
          isDemo: true,
          pendingDeletionAt: new Date('2026-08-01T00:00:00.000Z'),
        })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-restored', name: 'Restored SRL' })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.pendingDeletionAt).toBeNull()
      expect(row?.isDemo).toBe(false)
    })

    it('clears pendingDeletionAt when a marked client is restored into the demo list', async () => {
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Restored Demo SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-restored-demo', pendingDeletionAt: new Date('2026-08-01T00:00:00.000Z') })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([])
      fetchDemoTenantsMock.mockResolvedValue([fakeDemoTenant({ id: 'tenant-restored-demo' })])
      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.pendingDeletionAt).toBeNull()
      expect(row?.isDemo).toBe(true)
    })

    it('a terminated-fetch failure does not stop the real-tenant sync (isolated try/catch)', async () => {
      fetchTenantsMock.mockResolvedValue([fakeTenant({ id: 'tenant-real-ok-2', name: 'Real OK 2 SRL', slug: 'real-ok-2' })])
      fetchTerminatedTenantsMock.mockRejectedValue(new Error('vanagreen terminated endpoint down'))

      await expect(runVanagreenTenantSyncJob()).resolves.not.toThrow()
      await cleanupByVanagreenId('tenant-real-ok-2')

      const [row] = await db.select().from(billingClients).where(eq(billingClients.vanagreenTenantId, 'tenant-real-ok-2'))
      expect(row).toBeDefined()
    })
  })

  describe('purgePendingDeletionClients (2026-08-11 — soft-delete after 30 days, in lockstep with vanagreen purge-cron)', () => {
    it('soft-deletes a client whose pendingDeletionAt is more than 30 days old', async () => {
      const oldEnough = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Overdue Purge SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-overdue', pendingDeletionAt: oldEnough })
        .returning()
      clientIds.push(existing!.id)
      fetchTenantsMock.mockResolvedValue([])

      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.deletedAt).not.toBeNull()
    })

    it('does NOT purge a client whose pendingDeletionAt is within the 30-day window', async () => {
      const recentEnough = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Recent Purge Mark SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-recent', pendingDeletionAt: recentEnough })
        .returning()
      clientIds.push(existing!.id)
      fetchTenantsMock.mockResolvedValue([])

      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.deletedAt).toBeNull()
    })

    it('purges even when the demo/inactive/terminated fetches all fail today (runs on local state alone)', async () => {
      const oldEnough = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const [existing] = await db
        .insert(billingClients)
        .values({ name: 'Purge Despite Failures SRL', cif: 'RO1', address: 'x', vanagreenTenantId: 'tenant-purge-despite-failures', pendingDeletionAt: oldEnough })
        .returning()
      clientIds.push(existing!.id)

      fetchTenantsMock.mockResolvedValue([])
      fetchDemoTenantsMock.mockRejectedValue(new Error('down'))
      fetchInactiveTenantsMock.mockRejectedValue(new Error('down'))
      fetchTerminatedTenantsMock.mockRejectedValue(new Error('down'))

      await runVanagreenTenantSyncJob()

      const [row] = await db.select().from(billingClients).where(eq(billingClients.id, existing!.id))
      expect(row?.deletedAt).not.toBeNull()
    })
  })
})
