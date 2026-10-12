/**
 * jobs/vanagreen-billing.ts — cron zilnic de auto-facturare vanagreen (Sprint C,
 * Track B; Sprint C, Track D: billingDueDate citit LOCAL din billing_clients, nu mai
 * e fetch către vanagreen; Sprint D, Track 3: linia de factură vine acum dintr-un
 * template `isDefaultForAutoInvoice`, nu mai dintr-un subscriptionPriceLei/Eur
 * hardcodat — vezi invoicing/service.test.ts pt. regula "un singur default per client").
 * Integration test, pg real pt. `billing_clients` (query reală, regula CLAUDE.md #9);
 * `modules/invoicing/service.js` e mockuit la graniță (are propriile teste dedicate).
 * Verificăm doar ORCHESTRAREA: cine e apelat, cu ce, și izolarea erorilor per client.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { billingClients, platforms } from '../shared/db/schema/index.js'

const hasInvoiceMock = vi.fn()
const getDefaultTemplateMock = vi.fn()
const createDraftMock = vi.fn()
const issueInvoiceMock = vi.fn()
const sendToAnafMock = vi.fn()

vi.mock('../modules/invoicing/service.js', () => ({
  hasInvoiceForClientOnDate: (...args: unknown[]) => hasInvoiceMock(...args),
  getDefaultPlatformTemplate: (...args: unknown[]) => getDefaultTemplateMock(...args),
  createDraftInvoice: (...args: unknown[]) => createDraftMock(...args),
  issueInvoice: (...args: unknown[]) => issueInvoiceMock(...args),
  sendInvoiceToAnaf: (...args: unknown[]) => sendToAnafMock(...args),
}))

const { runVanagreenBillingJob } = await import('./vanagreen-billing.js')

const TODAY_ISO = new Date().toISOString().slice(0, 10)
const clientIds: string[] = []
const platformIds: string[] = []

const DEFAULT_TEMPLATE = { id: 'tpl-1', name: 'Abonament lunar', currency: 'RON' }

/** Platformă fake (re-scope 2026-07-18 — template-ul implicit e per platformă, nu per client). */
async function makePlatform() {
  const [row] = await db
    .insert(platforms)
    .values({ name: 'QA VG Platform', type: 'qa-test', apiUrl: 'https://example.invalid', apiKeyEnc: 'x' })
    .returning()
  platformIds.push(row!.id)
  return row!
}

async function makeClient(overrides: Partial<typeof billingClients.$inferInsert>) {
  const [row] = await db
    .insert(billingClients)
    .values({
      name: 'VGBilling QA Client',
      cif: `RO${Math.floor(Math.random() * 1e8)}`,
      address: 'x',
      autoInvoiceEnabled: true,
      ...overrides,
    })
    .returning()
  clientIds.push(row!.id)
  return row!
}

beforeEach(() => {
  for (const m of [hasInvoiceMock, getDefaultTemplateMock, createDraftMock, issueInvoiceMock, sendToAnafMock]) {
    m.mockReset()
  }
  hasInvoiceMock.mockResolvedValue(false)
  getDefaultTemplateMock.mockResolvedValue(DEFAULT_TEMPLATE)
  createDraftMock.mockResolvedValue({ id: 'draft-1' })
  issueInvoiceMock.mockResolvedValue({ id: 'draft-1' })
  sendToAnafMock.mockResolvedValue({ id: 'draft-1' })
})

afterEach(async () => {
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
})

afterAll(async () => {
  vi.restoreAllMocks()
  if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds))
})

describe('runVanagreenBillingJob — orchestration + skip conditions', () => {
  it('does nothing when there are zero mapped+autoInvoiceEnabled clients', async () => {
    await runVanagreenBillingJob()
    expect(createDraftMock).not.toHaveBeenCalled()
  })

  it('skips clients not currently due (billingDueDate != today)', async () => {
    await makeClient({ vanagreenTenantId: 't-1', billingDueDate: '2020-01-01' })

    await runVanagreenBillingJob()
    expect(createDraftMock).not.toHaveBeenCalled()
  })

  it('idempotent: skips a client due today but who already has an invoice issued today', async () => {
    await makeClient({ vanagreenTenantId: 't-1', billingDueDate: TODAY_ISO })
    hasInvoiceMock.mockResolvedValue(true)

    await runVanagreenBillingJob()
    expect(createDraftMock).not.toHaveBeenCalled()
    expect(getDefaultTemplateMock).not.toHaveBeenCalled() // nu căutăm template dacă oricum sărim
  })

  it('generates the invoice from the platform default template (templateId, not a hardcoded line)', async () => {
    const platform = await makePlatform()
    const client = await makeClient({ vanagreenTenantId: 't-1', billingDueDate: TODAY_ISO, platformId: platform.id })

    await runVanagreenBillingJob()

    expect(getDefaultTemplateMock).toHaveBeenCalledWith(platform.id)
    expect(createDraftMock).toHaveBeenCalledTimes(1)
    expect(createDraftMock).toHaveBeenCalledWith({ billingClientId: client.id, templateId: DEFAULT_TEMPLATE.id })
    expect(issueInvoiceMock).toHaveBeenCalledWith('draft-1')
    expect(sendToAnafMock).toHaveBeenCalledWith('draft-1')
  })

  it('ignores billing_clients mapped to a vanagreenTenantId but not (yet) to any platform', async () => {
    await makeClient({ vanagreenTenantId: 't-1', billingDueDate: TODAY_ISO, platformId: null })
    await runVanagreenBillingJob()
    expect(createDraftMock).not.toHaveBeenCalled()
    expect(getDefaultTemplateMock).not.toHaveBeenCalled()
  })

  it('BUG fixat (gap semnalat de Stefan): un client due fără template default e SĂRIT, nu i se emite o factură goală', async () => {
    const platform = await makePlatform()
    await makeClient({ vanagreenTenantId: 't-1', billingDueDate: TODAY_ISO, platformId: platform.id })
    getDefaultTemplateMock.mockResolvedValue(null)

    await runVanagreenBillingJob()

    expect(createDraftMock).not.toHaveBeenCalled()
    expect(issueInvoiceMock).not.toHaveBeenCalled()
  })

  it('CRITICAL — per-client error isolation: one client throwing during issueInvoice does not stop the rest of the batch', async () => {
    const platform = await makePlatform()
    const clientA = await makeClient({ vanagreenTenantId: 't-a', billingDueDate: TODAY_ISO, platformId: platform.id })
    await makeClient({ vanagreenTenantId: 't-b', billingDueDate: TODAY_ISO, platformId: platform.id })
    issueInvoiceMock.mockImplementation(async (id: string) => {
      if (id === 'draft-1') throw new Error('ANAF profile incomplete')
      return { id }
    })
    createDraftMock.mockImplementation(async (input: { billingClientId: string }) => ({
      id: input.billingClientId === clientA.id ? 'draft-1' : 'draft-2',
    }))

    await expect(runVanagreenBillingJob()).resolves.not.toThrow()

    expect(createDraftMock).toHaveBeenCalledTimes(2) // ambii clienți au fost încercați
    expect(sendToAnafMock).toHaveBeenCalledWith('draft-2') // clientul B a mers până la capăt
    expect(sendToAnafMock).not.toHaveBeenCalledWith('draft-1') // clientul A a picat la issue, nu s-a trimis la ANAF
  })

  it('ignores billing_clients that are not mapped to any vanagreenTenantId', async () => {
    await makeClient({ vanagreenTenantId: null, billingDueDate: TODAY_ISO })
    await runVanagreenBillingJob()
    expect(createDraftMock).not.toHaveBeenCalled() // "mapped" filter e aplicat înainte de orice draft
  })

  it('ignores mapped clients with no billingDueDate set yet', async () => {
    await makeClient({ vanagreenTenantId: 't-1', billingDueDate: null })
    await runVanagreenBillingJob()
    expect(createDraftMock).not.toHaveBeenCalled()
  })
})
