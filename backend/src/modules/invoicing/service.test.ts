/**
 * modules/invoicing/service.ts — Sprint C, Track B additions:
 *  - `hasInvoiceForClientOnDate` (idempotency guard for jobs/vanagreen-billing.ts)
 *  - `createClient`/`updateClient` with the 6 new billing_clients columns, incl.
 *    the numeric round-trip (`toNumericInput` — number in, string out of Postgres,
 *    correct value back).
 * Integration test, pg real (test/setup.ts, pattern financials/service.test.ts).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { billingClients, exchangeRates, financialRecords, invoiceLineItems, platforms } from '../../shared/db/schema/index.js'
import {
  createClient,
  createDraftInvoice,
  createPlatformTemplate,
  deletePlatformTemplate,
  getDefaultPlatformTemplate,
  hasInvoiceForClientOnDate,
  listClientTemplates,
  listClients,
  listDemoClients,
  listPendingDeletionClients,
  listPlatformTemplates,
  resolveClientTemplateLines,
  resolveTemplateLines,
  updateClient,
  updatePlatformTemplate,
} from './service.js'

const clientIds: string[] = []
const recordIds: string[] = []
const platformIds: string[] = []

afterAll(async () => {
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
  if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds))
})

/** Platformă (aplicație integrată) fake, doar pt. teste — template-urile aparțin acum de o
 *  platformă, nu de un client (re-scope 2026-07-18). */
async function makeTemplatePlatform(name: string) {
  const [row] = await db
    .insert(platforms)
    .values({ name, type: 'qa-test', apiUrl: 'https://example.invalid', apiKeyEnc: 'x' })
    .returning()
  platformIds.push(row!.id)
  return row!
}

describe('createClient / updateClient — numeric round-trip for the new billing fields', () => {
  it('creates a client with subscriptionPriceLei as a number and reads it back correctly', async () => {
    const row = await createClient({
      name: 'QA Numeric Client',
      cif: 'RO12345678',
      address: 'Str. Test 3',
      country: 'RO',
      subscriptionPriceLei: 149.9,
      subscriptionPriceCurrency: 'lei',
      autoInvoiceEnabled: true,
      vanagreenExtendMonths: 1,
    })
    clientIds.push(row!.id)
    expect(row!.subscriptionPriceLei).toBe('149.90')
    expect(Number(row!.subscriptionPriceLei)).toBe(149.9)
    expect(row!.autoInvoiceEnabled).toBe(true)
  })

  it('creates a client with subscriptionPriceEur and vanagreenTenantId set', async () => {
    const row = await createClient({
      name: 'QA EUR Client',
      cif: 'RO87654321',
      address: 'Str. Test 4',
      country: 'RO',
      subscriptionPriceEur: 29.99,
      subscriptionPriceCurrency: 'eur',
      vanagreenTenantId: 'tenant-eur-1',
      vanagreenExtendMonths: 12,
    })
    clientIds.push(row!.id)
    expect(row!.subscriptionPriceEur).toBe('29.99')
    expect(row!.vanagreenTenantId).toBe('tenant-eur-1')
  })

  it('creates a client with all numeric/optional fields omitted — nulls, no crash', async () => {
    const row = await createClient({ name: 'QA Bare Client', cif: 'RO00000001', address: 'Str. Test 5', country: 'RO' })
    clientIds.push(row!.id)
    expect(row!.subscriptionPriceLei).toBeNull()
    expect(row!.subscriptionPriceEur).toBeNull()
    expect(row!.vanagreenTenantId).toBeNull()
    expect(row!.vanagreenExtendMonths).toBeNull()
    expect(row!.autoInvoiceEnabled).toBe(false)
    expect(row!.subscriptionPriceCurrency).toBe('lei') // default
  })

  it('updateClient round-trips a numeric change (149.9 -> 199.5)', async () => {
    const created = await createClient({ name: 'QA Update Client', cif: 'RO00000002', address: 'Str. Test 6', subscriptionPriceLei: 149.9, country: 'RO' })
    clientIds.push(created!.id)

    const updated = await updateClient(created!.id, { subscriptionPriceLei: 199.5 })
    expect(updated?.subscriptionPriceLei).toBe('199.50')
  })

  it('updateClient can explicitly null out a previously-set numeric field (unmap price)', async () => {
    const created = await createClient({ name: 'QA Nullify Client', cif: 'RO00000003', address: 'Str. Test 7', subscriptionPriceLei: 50, country: 'RO' })
    clientIds.push(created!.id)

    const updated = await updateClient(created!.id, { subscriptionPriceLei: null })
    expect(updated?.subscriptionPriceLei).toBeNull()
  })

  it('updateClient leaves subscriptionPriceLei untouched when the field is omitted (not sent = not touched, distinct from null)', async () => {
    const created = await createClient({ name: 'QA Partial Update Client', cif: 'RO00000004', address: 'Str. Test 8', subscriptionPriceLei: 75, country: 'RO' })
    clientIds.push(created!.id)

    const updated = await updateClient(created!.id, { name: 'QA Partial Update Client (renamed)' })
    expect(updated?.subscriptionPriceLei).toBe('75.00')
    expect(updated?.name).toBe('QA Partial Update Client (renamed)')
  })
})

describe('listClients / listDemoClients — separă clienții reali de scheletele demo (2026-08-03)', () => {
  it('listClients exclude un client isDemo:true, listDemoClients îl include', async () => {
    const real = await createClient({ name: 'QA Real Client', cif: 'RO1112223', address: 'Str. Real 1', country: 'RO' })
    clientIds.push(real!.id)
    const [demo] = await db
      .insert(billingClients)
      .values({ name: 'QA Demo Client', cif: '', address: '', needsBillingInfo: true, isDemo: true })
      .returning()
    clientIds.push(demo!.id)

    const reals = await listClients()
    expect(reals.some((c) => c.id === real!.id)).toBe(true)
    expect(reals.some((c) => c.id === demo!.id)).toBe(false)

    const demos = await listDemoClients()
    expect(demos.some((c) => c.id === demo!.id)).toBe(true)
    expect(demos.some((c) => c.id === real!.id)).toBe(false)
  })
})

describe('listPendingDeletionClients (2026-08-11) — clienți în ștergere, excluși din listClients/listDemoClients', () => {
  it('include un client cu pendingDeletionAt setat, exclus din listClients', async () => {
    const [pending] = await db
      .insert(billingClients)
      .values({ name: 'QA Pending Deletion Client', cif: 'RO1', address: 'x', pendingDeletionAt: new Date() })
      .returning()
    clientIds.push(pending!.id)

    const reals = await listClients()
    expect(reals.some((c) => c.id === pending!.id)).toBe(false)

    const pendingRows = await listPendingDeletionClients()
    expect(pendingRows.some((c) => c.id === pending!.id)).toBe(true)
  })

  it('un client demo cu pendingDeletionAt setat e exclus și din listDemoClients', async () => {
    const [pending] = await db
      .insert(billingClients)
      .values({ name: 'QA Pending Deletion Demo Client', cif: '', address: '', isDemo: true, pendingDeletionAt: new Date() })
      .returning()
    clientIds.push(pending!.id)

    const demos = await listDemoClients()
    expect(demos.some((c) => c.id === pending!.id)).toBe(false)

    const pendingRows = await listPendingDeletionClients()
    expect(pendingRows.some((c) => c.id === pending!.id)).toBe(true)
  })
})

describe('hasInvoiceForClientOnDate', () => {
  async function makeInvoice(billingClientId: string, issuedAt: Date, overrides: Partial<typeof financialRecords.$inferInsert> = {}) {
    const [row] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'out',
        source: 'generated',
        amount: '100.00',
        currency: 'RON',
        issuedAt,
        billingClientId,
        ...overrides,
      })
      .returning()
    recordIds.push(row!.id)
    return row!
  }

  it('returns true when an invoice was already issued today for this client', async () => {
    const client = await createClient({ name: 'QA HasInvoice Client A', cif: 'RO00000005', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    await makeInvoice(client!.id, new Date())

    expect(await hasInvoiceForClientOnDate(client!.id, new Date().toISOString().slice(0, 10))).toBe(true)
  })

  it('returns false for a different date (yesterday)', async () => {
    const client = await createClient({ name: 'QA HasInvoice Client B', cif: 'RO00000006', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await makeInvoice(client!.id, yesterday)

    expect(await hasInvoiceForClientOnDate(client!.id, new Date().toISOString().slice(0, 10))).toBe(false)
  })

  it('returns false when the record exists today but with direction "in" (received invoice, not one we issued)', async () => {
    const client = await createClient({ name: 'QA HasInvoice Client C', cif: 'RO00000007', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    await makeInvoice(client!.id, new Date(), { direction: 'in', source: 'anaf_efactura' })

    expect(await hasInvoiceForClientOnDate(client!.id, new Date().toISOString().slice(0, 10))).toBe(false)
  })

  it('returns false when there is no invoice at all for the client', async () => {
    const client = await createClient({ name: 'QA HasInvoice Client D', cif: 'RO00000008', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    expect(await hasInvoiceForClientOnDate(client!.id, new Date().toISOString().slice(0, 10))).toBe(false)
  })

  it('returns false for a soft-deleted invoice issued today (should not count)', async () => {
    const client = await createClient({ name: 'QA HasInvoice Client E', cif: 'RO00000009', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    await makeInvoice(client!.id, new Date(), { deletedAt: new Date() })

    expect(await hasInvoiceForClientOnDate(client!.id, new Date().toISOString().slice(0, 10))).toBe(false)
  })

  it('day-boundary: an invoice issued at 23:59:59.999Z counts for that date, one issued at 00:00:00.000Z the next day does not', async () => {
    const client = await createClient({ name: 'QA HasInvoice Client F', cif: 'RO00000010', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    await makeInvoice(client!.id, new Date('2031-05-01T23:59:59.999Z'))

    expect(await hasInvoiceForClientOnDate(client!.id, '2031-05-01')).toBe(true)
    expect(await hasInvoiceForClientOnDate(client!.id, '2031-05-02')).toBe(false)
  })
})

describe('invoice templates per platform (Sprint D, Track 3; re-scope 2026-07-18)', () => {
  async function makeTemplateClient(name: string, cif: string, platformId?: string) {
    const client = await createClient({ name, cif, address: 'x', country: 'RO', platformId })
    clientIds.push(client!.id)
    return client!
  }

  it('createPlatformTemplate creates a template with lineItems + default currency RON', async () => {
    const platform = await makeTemplatePlatform('QA Platform A')
    const template = await createPlatformTemplate(platform.id, {
      name: 'Abonament lunar',
      currency: 'RON',
      lineItems: [{ description: 'Abonament', quantity: 1, priceSource: 'fixed', unitPrice: 100, vatRatePct: 19 }],
    })
    expect(template.platformId).toBe(platform.id)
    expect(template.currency).toBe('RON')
    expect(template.isDefaultForAutoInvoice).toBe(false)
    expect(template.lineItems).toEqual([{ description: 'Abonament', quantity: 1, priceSource: 'fixed', unitPrice: 100, vatRatePct: 19 }])
  })

  it('listPlatformTemplates returns only templates for that platform, ordered by name, excludes soft-deleted', async () => {
    const platformA = await makeTemplatePlatform('QA Platform B')
    const platformB = await makeTemplatePlatform('QA Platform C')
    await createPlatformTemplate(platformA.id, { name: 'Z Template', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })
    await createPlatformTemplate(platformA.id, { name: 'A Template', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })
    await createPlatformTemplate(platformB.id, { name: 'Other Platform Template', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })
    const toDelete = await createPlatformTemplate(platformA.id, { name: 'Deleted Template', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })
    await deletePlatformTemplate(platformA.id, toDelete.id)

    const rows = await listPlatformTemplates(platformA.id)
    expect(rows.map((r) => r.name)).toEqual(['A Template', 'Z Template'])
  })

  it('"cel mult un default per platformă": setting a second template as default un-defaults the first', async () => {
    const platform = await makeTemplatePlatform('QA Platform D')
    const first = await createPlatformTemplate(platform.id, {
      name: 'Prima',
      currency: 'RON',
      lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }],
      isDefaultForAutoInvoice: true,
    })
    expect(first.isDefaultForAutoInvoice).toBe(true)

    const second = await createPlatformTemplate(platform.id, {
      name: 'A doua',
      currency: 'RON',
      lineItems: [{ description: 'y', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }],
      isDefaultForAutoInvoice: true,
    })
    expect(second.isDefaultForAutoInvoice).toBe(true)

    const rows = await listPlatformTemplates(platform.id)
    const firstAfter = rows.find((r) => r.id === first.id)
    expect(firstAfter?.isDefaultForAutoInvoice).toBe(false)
  })

  it('"cel mult un default per platformă" ține și pe UPDATE (nu doar la creare)', async () => {
    const platform = await makeTemplatePlatform('QA Platform E')
    const first = await createPlatformTemplate(platform.id, {
      name: 'Prima',
      currency: 'RON',
      lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }],
      isDefaultForAutoInvoice: true,
    })
    const second = await createPlatformTemplate(platform.id, {
      name: 'A doua',
      currency: 'RON',
      lineItems: [{ description: 'y', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }],
    })

    await updatePlatformTemplate(platform.id, second.id, { isDefaultForAutoInvoice: true })

    const rows = await listPlatformTemplates(platform.id)
    expect(rows.find((r) => r.id === first.id)?.isDefaultForAutoInvoice).toBe(false)
    expect(rows.find((r) => r.id === second.id)?.isDefaultForAutoInvoice).toBe(true)
  })

  it('updatePlatformTemplate 404s (returns null) for a template belonging to a DIFFERENT platform', async () => {
    const platformA = await makeTemplatePlatform('QA Platform F')
    const platformB = await makeTemplatePlatform('QA Platform G')
    const template = await createPlatformTemplate(platformA.id, { name: 'x', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })

    expect(await updatePlatformTemplate(platformB.id, template.id, { name: 'hijacked' })).toBeNull()
  })

  it('deletePlatformTemplate soft-deletes and returns false for an already-deleted / unknown id', async () => {
    const platform = await makeTemplatePlatform('QA Platform H')
    const template = await createPlatformTemplate(platform.id, { name: 'x', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })

    expect(await deletePlatformTemplate(platform.id, template.id)).toBe(true)
    expect(await deletePlatformTemplate(platform.id, template.id)).toBe(false)
    expect(await getDefaultPlatformTemplate(platform.id)).toBeNull()
  })

  it('getDefaultPlatformTemplate returns null when no template is marked default', async () => {
    const platform = await makeTemplatePlatform('QA Platform I')
    await createPlatformTemplate(platform.id, { name: 'x', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })
    expect(await getDefaultPlatformTemplate(platform.id)).toBeNull()
  })

  it('listClientTemplates: derives templates from the client platform, [] when unmapped (100 clients, 1 template — no per-client duplication)', async () => {
    const platform = await makeTemplatePlatform('QA Platform J')
    await createPlatformTemplate(platform.id, { name: 'Abonament', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })
    const mappedClient = await makeTemplateClient('QA Mapped Client', 'RO10000010', platform.id)
    const unmappedClient = await makeTemplateClient('QA Unmapped Client', 'RO10000011')

    expect((await listClientTemplates(mappedClient.id)).map((t) => t.name)).toEqual(['Abonament'])
    expect(await listClientTemplates(unmappedClient.id)).toEqual([])
  })
})

describe('createDraftInvoice with templateId (Sprint D, Track 3)', () => {
  it('copies lineItems + currency from the template when only templateId is given', async () => {
    const platform = await makeTemplatePlatform('QA Platform K')
    const client = await createClient({ name: 'QA Draft Template Client A', cif: 'RO20000001', address: 'x', country: 'RO', platformId: platform.id })
    clientIds.push(client!.id)
    const template = await createPlatformTemplate(platform.id, {
      name: 'Abonament',
      currency: 'EUR',
      lineItems: [{ description: 'Abonament VanaGreen', quantity: 1, priceSource: 'fixed', unitPrice: 90, vatRatePct: 19 }],
    })

    const draft = await createDraftInvoice({ billingClientId: client!.id, templateId: template.id })
    recordIds.push(draft.id)

    expect(draft.currency).toBe('EUR')
    expect(draft.amount).toBe('107.10') // 90 * 1.19

    const lines = await db.select().from(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, [draft.id]))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.description).toBe('Abonament VanaGreen')
    expect(lines[0]?.vatRate).toBe('19.00')
  })

  it('explicit lines override the template lineItems (special-case invoice), but currency still falls back to the template', async () => {
    const platform = await makeTemplatePlatform('QA Platform L')
    const client = await createClient({ name: 'QA Draft Template Client B', cif: 'RO20000002', address: 'x', country: 'RO', platformId: platform.id })
    clientIds.push(client!.id)
    const template = await createPlatformTemplate(platform.id, {
      name: 'Abonament',
      currency: 'USD',
      lineItems: [{ description: 'Template line', quantity: 1, priceSource: 'fixed', unitPrice: 999, vatRatePct: 19 }],
    })

    const draft = await createDraftInvoice({
      billingClientId: client!.id,
      templateId: template.id,
      lines: [{ description: 'Linie specială', quantity: 2, unitPrice: 10, vatRate: 0 }],
    })
    recordIds.push(draft.id)

    expect(draft.currency).toBe('USD') // din template, fiindcă input.currency lipsește
    expect(draft.amount).toBe('20.00') // 2 * 10, NU 999 din template
  })

  it('throws when templateId points at a template belonging to a platform the client is NOT mapped to', async () => {
    const platformA = await makeTemplatePlatform('QA Platform M')
    const platformB = await makeTemplatePlatform('QA Platform N')
    const clientA = await createClient({ name: 'QA Draft Template Client C', cif: 'RO20000003', address: 'x', country: 'RO', platformId: platformA.id })
    const clientB = await createClient({ name: 'QA Draft Template Client D', cif: 'RO20000004', address: 'x', country: 'RO', platformId: platformB.id })
    clientIds.push(clientA!.id, clientB!.id)
    const template = await createPlatformTemplate(platformA.id, { name: 'x', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })

    await expect(createDraftInvoice({ billingClientId: clientB!.id, templateId: template.id })).rejects.toThrow(/Template de factură inexistent/)
  })

  it('throws when the client is not mapped to any platform at all', async () => {
    const platform = await makeTemplatePlatform('QA Platform O')
    const client = await createClient({ name: 'QA Draft Template Client Unmapped', cif: 'RO20000008', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    const template = await createPlatformTemplate(platform.id, { name: 'x', currency: 'RON', lineItems: [{ description: 'x', quantity: 1, priceSource: 'fixed', unitPrice: 1, vatRatePct: 0 }] })

    await expect(createDraftInvoice({ billingClientId: client!.id, templateId: template.id })).rejects.toThrow(/nu e mapat la nicio platformă/)
  })

  it('throws when neither templateId nor lines are given', async () => {
    const client = await createClient({ name: 'QA Draft Template Client E', cif: 'RO20000005', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    await expect(createDraftInvoice({ billingClientId: client!.id })).rejects.toThrow(/cel puțin o linie/)
  })

  it('defaults currency to RON when neither input nor a plain (non-template) call specifies one', async () => {
    const client = await createClient({ name: 'QA Draft Template Client F', cif: 'RO20000006', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    const draft = await createDraftInvoice({
      billingClientId: client!.id,
      lines: [{ description: 'x', quantity: 1, unitPrice: 10, vatRate: 0 }],
    })
    recordIds.push(draft.id)
    expect(draft.currency).toBe('RON')
  })
})

describe('template line priceSource: "client_subscription" (Add-on pricing follow-up, 2026-07-18)', () => {
  // Un an îndepărtat, ca la restul fișierului cu curs BNR — nu se ciocnește cu rate reale.
  const RATE_DATE = '2031-03-01'

  async function withEurRate<T>(rate: string, fn: () => Promise<T>): Promise<T> {
    await db.insert(exchangeRates).values({ date: RATE_DATE, currency: 'EUR', rate })
    try {
      return await fn()
    } finally {
      await db.delete(exchangeRates).where(and(eq(exchangeRates.currency, 'EUR'), eq(exchangeRates.date, RATE_DATE)))
    }
  }

  it('resolveTemplateLines: fixed line ignores the client entirely', async () => {
    const client = await createClient({ name: 'QA Price Client A', cif: 'RO30000001', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    const { lines, discountConsumed } = await resolveTemplateLines(
      [{ description: 'Setup', quantity: 1, priceSource: 'fixed', unitPrice: 150, vatRatePct: 19 }],
      client!,
      'RON',
      RATE_DATE,
    )
    expect(lines).toEqual([{ description: 'Setup', quantity: 1, unitPrice: 150, vatRate: 19 }])
    expect(discountConsumed).toBe(false)
  })

  it('resolveTemplateLines: client_subscription line matching currency needs no conversion', async () => {
    const client = await createClient({
      name: 'QA Price Client B',
      cif: 'RO30000002',
      address: 'x',
      country: 'RO',
      subscriptionPriceLei: 200,
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    const { lines, discountConsumed } = await resolveTemplateLines(
      [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
      client!,
      'RON',
      RATE_DATE,
    )
    expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 200, vatRate: 19 }])
    expect(discountConsumed).toBe(false)
  })

  it('resolveTemplateLines: converts EUR subscription price to a RON invoice via the BNR rate of that date', async () => {
    const client = await createClient({
      name: 'QA Price Client C',
      cif: 'RO30000003',
      address: 'x',
      country: 'RO',
      subscriptionPriceEur: 100,
      subscriptionPriceCurrency: 'eur',
    })
    clientIds.push(client!.id)
    await withEurRate('5.000000', async () => {
      const { lines } = await resolveTemplateLines(
        [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
        client!,
        'RON',
        RATE_DATE,
      )
      expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 500, vatRate: 19 }])
    })
  })

  it('resolveTemplateLines: converts RON subscription price to a EUR invoice via the BNR rate of that date', async () => {
    const client = await createClient({
      name: 'QA Price Client D',
      cif: 'RO30000004',
      address: 'x',
      country: 'RO',
      subscriptionPriceLei: 500,
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    await withEurRate('5.000000', async () => {
      const { lines } = await resolveTemplateLines(
        [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
        client!,
        'EUR',
        RATE_DATE,
      )
      expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 100, vatRate: 19 }])
    })
  })

  it('resolveTemplateLines: throws a descriptive error when the client has no subscription price set yet', async () => {
    const client = await createClient({ name: 'QA Price Client E', cif: 'RO30000005', address: 'x', country: 'RO' })
    clientIds.push(client!.id)
    await expect(
      resolveTemplateLines(
        [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
        client!,
        'RON',
        RATE_DATE,
      ),
    ).rejects.toThrow(/nu are preț de abonament setat/)
  })

  it('resolveClientTemplateLines: end-to-end via a real template + client, defaults to the template currency', async () => {
    const platform = await makeTemplatePlatform('QA Platform P')
    const client = await createClient({
      name: 'QA Price Client F',
      cif: 'RO30000006',
      address: 'x',
      country: 'RO',
      platformId: platform.id,
      subscriptionPriceEur: 200,
      subscriptionPriceCurrency: 'eur',
    })
    clientIds.push(client!.id)
    const template = await createPlatformTemplate(platform.id, {
      name: 'Abonament',
      currency: 'EUR',
      lineItems: [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
    })

    const resolved = await resolveClientTemplateLines(client!.id, template.id)
    expect(resolved.currency).toBe('EUR')
    expect(resolved.lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 200, vatRate: 19 }])
  })

  it('createDraftInvoice: a template line with priceSource "client_subscription" pulls the CURRENT client price, converted to the invoice currency', async () => {
    const platform = await makeTemplatePlatform('QA Platform Q')
    const client = await createClient({
      name: 'QA Price Client G',
      cif: 'RO30000007',
      address: 'x',
      country: 'RO',
      platformId: platform.id,
      subscriptionPriceEur: 100,
      subscriptionPriceCurrency: 'eur',
    })
    clientIds.push(client!.id)
    const template = await createPlatformTemplate(platform.id, {
      name: 'Abonament',
      currency: 'RON',
      lineItems: [{ description: 'Abonament VanaGreen', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
      isDefaultForAutoInvoice: true,
    })

    await withEurRate('5.000000', async () => {
      const draft = await createDraftInvoice({ billingClientId: client!.id, templateId: template.id, issuedAt: new Date(`${RATE_DATE}T10:00:00.000Z`) })
      recordIds.push(draft.id)
      expect(draft.currency).toBe('RON')
      expect(draft.amount).toBe('595.00') // 100 EUR * 5.00 = 500 RON, +19% TVA

      // A price step-up: change the client's price and the invoice already issued stays as it
      // was, while a new invoice from the same template carries the new price. The template is
      // not touched.
      await updateClient(client!.id, { subscriptionPriceEur: 200 })
      const draft2 = await createDraftInvoice({ billingClientId: client!.id, templateId: template.id, issuedAt: new Date(`${RATE_DATE}T10:00:00.000Z`) })
      recordIds.push(draft2.id)
      expect(draft2.amount).toBe('1190.00') // 200 EUR * 5.00 = 1000 RON, +19% TVA
    })
  })
})

describe('referral discount pending — aplicare + plafon 90% + consum atomic (sprint Referral discount status, 2026-08-12)', () => {
  const RATE_DATE = '2031-04-01'

  async function withEurRate<T>(rate: string, fn: () => Promise<T>): Promise<T> {
    await db.insert(exchangeRates).values({ date: RATE_DATE, currency: 'EUR', rate })
    try {
      return await fn()
    } finally {
      await db.delete(exchangeRates).where(and(eq(exchangeRates.currency, 'EUR'), eq(exchangeRates.date, RATE_DATE)))
    }
  }

  async function setPendingDiscount(clientId: string, amount: string, currency: 'lei' | 'eur') {
    await db
      .update(billingClients)
      .set({ referralDiscountReferralId: 'ref-test', referralDiscountPendingAmount: amount, referralDiscountPendingCurrency: currency })
      .where(eq(billingClients.id, clientId))
  }

  it('resolveTemplateLines: pending sub plafon -> discountul întreg se scade, discountConsumed:true', async () => {
    const client = await createClient({
      name: 'QA Referral Client A',
      cif: 'RO40000001',
      address: 'x',
      country: 'RO',
      subscriptionPriceLei: 200,
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    await setPendingDiscount(client!.id, '30.00', 'lei')

    const fresh = (await db.select().from(billingClients).where(eq(billingClients.id, client!.id)))[0]!
    const { lines, discountConsumed } = await resolveTemplateLines(
      [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
      fresh,
      'RON',
      RATE_DATE,
    )
    expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 170, vatRate: 19 }]) // 200 - 30
    expect(discountConsumed).toBe(true)
  })

  it('resolveTemplateLines: plafonul de 90% respectat când prețul CURENT e mai mic decât la grant (discount fix, preț scăzut între timp)', async () => {
    const client = await createClient({
      name: 'QA Referral Client B',
      cif: 'RO40000002',
      address: 'x',
      country: 'RO',
      subscriptionPriceLei: 50, // prețul curent, MULT mai mic decât la momentul grant-ului
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    await setPendingDiscount(client!.id, '30.00', 'lei') // 30 lei fixat la grant, când prețul era mai mare

    const fresh = (await db.select().from(billingClients).where(eq(billingClients.id, client!.id)))[0]!
    const { lines, discountConsumed } = await resolveTemplateLines(
      [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
      fresh,
      'RON',
      RATE_DATE,
    )
    // cap = 50 * 0.9 = 45, dar discountul pending (30) < cap -> se aplică tot 30 aici încă
    expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 20, vatRate: 19 }])
    expect(discountConsumed).toBe(true)
  })

  it('resolveTemplateLines: discountul pending DEPĂȘEȘTE plafonul de 90% -> tăiat la cap, nu la valoarea brută', async () => {
    const client = await createClient({
      name: 'QA Referral Client C',
      cif: 'RO40000003',
      address: 'x',
      country: 'RO',
      subscriptionPriceLei: 20, // preț curent foarte mic
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    await setPendingDiscount(client!.id, '30.00', 'lei') // 30 lei pending > 90% din 20 (=18)

    const fresh = (await db.select().from(billingClients).where(eq(billingClients.id, client!.id)))[0]!
    const { lines, discountConsumed } = await resolveTemplateLines(
      [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
      fresh,
      'RON',
      RATE_DATE,
    )
    // cap = 20 * 0.9 = 18 -> preț final = 20 - 18 = 2, NU 20 - 30 (negativ)
    expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 2, vatRate: 19 }])
    expect(discountConsumed).toBe(true)
  })

  it('resolveTemplateLines: discountul pending e convertit la moneda facturii înainte de plafonare', async () => {
    const client = await createClient({
      name: 'QA Referral Client D',
      cif: 'RO40000004',
      address: 'x',
      country: 'RO',
      subscriptionPriceEur: 100,
      subscriptionPriceCurrency: 'eur',
    })
    clientIds.push(client!.id)
    await setPendingDiscount(client!.id, '50.00', 'lei') // pending în LEI, factura e în EUR

    await withEurRate('5.000000', async () => {
      const fresh = (await db.select().from(billingClients).where(eq(billingClients.id, client!.id)))[0]!
      const { lines, discountConsumed } = await resolveTemplateLines(
        [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
        fresh,
        'EUR',
        RATE_DATE,
      )
      // 50 lei / 5.00 = 10 EUR discount, preț final = 100 - 10 = 90
      expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 90, vatRate: 19 }])
      expect(discountConsumed).toBe(true)
    })
  })

  it('resolveTemplateLines: template cu 2 linii client_subscription -> discountul pending se aplică o SINGURĂ dată (pe prima), nu dublat', async () => {
    const client = await createClient({
      name: 'QA Referral Client Multi-Line',
      cif: 'RO40000008',
      address: 'x',
      country: 'RO',
      subscriptionPriceLei: 200,
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    await setPendingDiscount(client!.id, '30.00', 'lei')

    const fresh = (await db.select().from(billingClients).where(eq(billingClients.id, client!.id)))[0]!
    const { lines, discountConsumed } = await resolveTemplateLines(
      [
        { description: 'Abonament A', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 },
        { description: 'Abonament B', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 },
      ],
      fresh,
      'RON',
      RATE_DATE,
    )
    expect(lines).toEqual([
      { description: 'Abonament A', quantity: 1, unitPrice: 170, vatRate: 19 }, // 200 - 30
      { description: 'Abonament B', quantity: 1, unitPrice: 200, vatRate: 19 }, // fără discount, deja consumat de prima linie
    ])
    expect(discountConsumed).toBe(true)
  })

  it('fără pending -> comportament identic cu azi, discountConsumed:false', async () => {
    const client = await createClient({
      name: 'QA Referral Client E',
      cif: 'RO40000005',
      address: 'x',
      country: 'RO',
      subscriptionPriceLei: 200,
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)

    const { lines, discountConsumed } = await resolveTemplateLines(
      [{ description: 'Abonament', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
      client!,
      'RON',
      RATE_DATE,
    )
    expect(lines).toEqual([{ description: 'Abonament', quantity: 1, unitPrice: 200, vatRate: 19 }])
    expect(discountConsumed).toBe(false)
  })

  it('createDraftInvoice: consumă pending-ul atomic — factura reflectă prețul redus ȘI billing_clients e curățat în aceeași tranzacție', async () => {
    const platform = await makeTemplatePlatform('QA Platform Referral A')
    const client = await createClient({
      name: 'QA Referral Client F',
      cif: 'RO40000006',
      address: 'x',
      country: 'RO',
      platformId: platform.id,
      subscriptionPriceLei: 200,
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    await setPendingDiscount(client!.id, '30.00', 'lei')
    const template = await createPlatformTemplate(platform.id, {
      name: 'Abonament',
      currency: 'RON',
      lineItems: [{ description: 'Abonament VanaGreen', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
    })

    const draft = await createDraftInvoice({ billingClientId: client!.id, templateId: template.id, issuedAt: new Date(`${RATE_DATE}T10:00:00.000Z`) })
    recordIds.push(draft.id)
    expect(draft.amount).toBe('202.30') // (200 - 30) * 1.19

    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client!.id))
    expect(updated?.referralDiscountReferralId).toBeNull()
    expect(updated?.referralDiscountPendingAmount).toBeNull()
    expect(updated?.referralDiscountPendingCurrency).toBeNull()
  })

  it('createDraftInvoice: reducerea se consumă O SINGURĂ dată chiar dacă clientul primește 2 facturi generate template în aceeași zi (manual + auto)', async () => {
    const platform = await makeTemplatePlatform('QA Platform Referral B')
    const client = await createClient({
      name: 'QA Referral Client G',
      cif: 'RO40000007',
      address: 'x',
      country: 'RO',
      platformId: platform.id,
      subscriptionPriceLei: 200,
      subscriptionPriceCurrency: 'lei',
    })
    clientIds.push(client!.id)
    await setPendingDiscount(client!.id, '30.00', 'lei')
    const template = await createPlatformTemplate(platform.id, {
      name: 'Abonament',
      currency: 'RON',
      lineItems: [{ description: 'Abonament VanaGreen', quantity: 1, priceSource: 'client_subscription', unitPrice: null, vatRatePct: 19 }],
    })

    const draft1 = await createDraftInvoice({ billingClientId: client!.id, templateId: template.id, issuedAt: new Date(`${RATE_DATE}T09:00:00.000Z`) })
    recordIds.push(draft1.id)
    const draft2 = await createDraftInvoice({ billingClientId: client!.id, templateId: template.id, issuedAt: new Date(`${RATE_DATE}T15:00:00.000Z`) })
    recordIds.push(draft2.id)

    expect(draft1.amount).toBe('202.30') // (200 - 30) * 1.19 — prima factură consumă discountul
    expect(draft2.amount).toBe('238.00') // 200 * 1.19 — a doua factură, deja fără pending

    const [updated] = await db.select().from(billingClients).where(eq(billingClients.id, client!.id))
    expect(updated?.referralDiscountPendingAmount).toBeNull()
  })
})
