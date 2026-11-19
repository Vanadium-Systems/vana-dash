import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { billingClients, financialRecords, invoicePayments } from '../../shared/db/schema/index.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { billingStateFrom, billingStateV1Schema, buildBillingState, sameBillingState, type BillingStateInput } from './billing-state.js'

// The same fixtures VanaGreen tests its receiving route against (a copy of this folder lives in
// recyclers_app backend/test/fixtures/vanadash-billing-state.v1/).
const FIXTURES = join(import.meta.dirname, 'contract', 'billing-state.v1')
const read = (kind: 'valid' | 'invalid') =>
  readdirSync(join(FIXTURES, kind)).map((name) => ({ name, body: JSON.parse(readFileSync(join(FIXTURES, kind, name), 'utf8')) as unknown }))
const fixture = (name: string) => read('valid').find((f) => f.name === name)!.body

describe('billing-state v1 schema and the shared fixtures', () => {
  it.each(read('valid'))('accepts valid/$name', ({ body }) => {
    expect(billingStateV1Schema.safeParse(body).success).toBe(true)
  })
  it.each(read('invalid'))('refuses invalid/$name', ({ body }) => {
    expect(billingStateV1Schema.safeParse(body).success).toBe(false)
  })
})

describe('billingStateFrom builds exactly the fixtures', () => {
  const base: Omit<BillingStateInput, 'unpaidDueOn' | 'nextInvoiceOn' | 'paying'> = {
    timeZone: 'Europe/Bucharest',
    paymentTermsDays: 15,
    period: 'monthly',
    cycleDay: 1,
    cycleMonth: null,
  }
  const cases: Array<[string, BillingStateInput]> = [
    ['unpaid-invoice.json', { ...base, unpaidDueOn: '2026-11-16', nextInvoiceOn: '2026-12-01', paying: true }],
    ['nothing-owed.json', { ...base, unpaidDueOn: null, nextInvoiceOn: '2026-12-01', paying: true }],
    ['annual.json', { ...base, period: 'annual', cycleDay: 15, cycleMonth: 3, unpaidDueOn: null, nextInvoiceOn: '2027-03-15', paying: true }],
    ['trial-first-invoice.json', { ...base, cycleDay: 5, unpaidDueOn: '2026-11-20', nextInvoiceOn: '2026-12-05', paying: false }],
  ]
  it.each(cases)('%s', (name, input) => {
    expect(billingStateFrom(input)).toEqual(fixture(name))
  })
  it('every valid fixture has a case here', () => {
    expect(read('valid').map((f) => f.name).sort()).toEqual(cases.map(([name]) => name).sort())
  })
  it('a monthly cycle drops a stale month', () => {
    expect(billingStateFrom({ ...base, cycleMonth: 7, unpaidDueOn: null, nextInvoiceOn: '2026-12-01', paying: true }).cycle.month).toBeNull()
  })
  it('compares states without caring about key order', () => {
    const state = fixture('annual.json') as Record<string, unknown>
    const reordered = Object.fromEntries(Object.entries(state).reverse())
    expect(sameBillingState(state, reordered)).toBe(true)
    expect(sameBillingState(state, { ...state, paying: false })).toBe(false)
    expect(sameBillingState(null, state)).toBe(false)
  })
})

// The database side, moved from shared/lib/client-payment-due.test.ts: which invoice counts as unpaid.
const clientIds: string[] = []

async function makeClient(billingDueDate: string | null, paymentTermsDays: number | null) {
  const [row] = await db
    .insert(billingClients)
    .values({
      name: 'Due QA Client',
      cif: `RO${Math.floor(Math.random() * 1e8)}`,
      address: 'x',
      billingDueDate,
      paymentTermsDays,
      billingCycle: billingDueDate ? 'monthly' : null,
      billingCycleDay: billingDueDate ? 1 : null,
    })
    .returning()
  clientIds.push(row!.id)
  return row!
}

async function makeInvoice(billingClientId: string, dueDay: string, overrides: Partial<typeof financialRecords.$inferInsert> = {}) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      amount: '100.00',
      currency: 'RON',
      source: 'generated',
      billingClientId,
      issuedAt: new Date(`${dueDay}T08:00:00.000Z`),
      dueAt: new Date(`${dueDay}T12:00:00.000Z`),
      documentNumber: `TST-${Math.floor(Math.random() * 1e9)}`,
      paymentStatus: 'unpaid',
      ...overrides,
    })
    .returning()
  return row!
}

afterEach(async () => {
  if (!clientIds.length) return
  const records = await db.select({ id: financialRecords.id }).from(financialRecords).where(inArray(financialRecords.billingClientId, clientIds))
  if (records.length) await db.delete(invoicePayments).where(inArray(invoicePayments.recordId, records.map((r) => r.id)))
  await db.delete(financialRecords).where(inArray(financialRecords.billingClientId, clientIds))
  await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
})

describe('buildBillingState', () => {
  it('is due on the oldest unpaid invoice, whatever the next invoice day', async () => {
    const client = await makeClient('2026-12-01', 15)
    await makeInvoice(client.id, '2026-11-16')
    await makeInvoice(client.id, '2026-10-16')
    const state = await buildBillingState(client)
    expect([state?.paymentDueOn, state?.paymentDueKind, state?.nextInvoiceOn]).toEqual(['2026-10-16', 'unpaid_invoice', '2026-12-01'])
    expect(state?.timeZone).toBe(await getCompanyTimeZone())
  })

  it('ignores paid invoices, drafts, deleted ones and stornos', async () => {
    const client = await makeClient('2026-12-01', 15)
    const original = await makeInvoice(client.id, '2026-08-16', { paymentStatus: 'paid' })
    await makeInvoice(client.id, '2026-09-16', { documentNumber: null })
    await makeInvoice(client.id, '2026-10-16', { deletedAt: new Date() })
    await makeInvoice(client.id, '2026-10-20', { amount: '-100.00', correctsRecordId: original.id })
    const state = await buildBillingState(client)
    expect([state?.paymentDueOn, state?.paymentDueKind, state?.paying]).toEqual(['2026-12-16', 'next_invoice', true])
  })

  it('with nothing owed, is the next invoice day plus the payment terms', async () => {
    expect((await buildBillingState(await makeClient('2026-12-30', 5)))?.paymentDueOn).toBe('2027-01-04')
    expect((await buildBillingState(await makeClient('2026-12-01', null)))?.paymentDueOn).toBe('2026-12-01')
  })

  it('paying: a recorded payment counts, an unpaid or a stornoed invoice does not', async () => {
    const client = await makeClient('2026-12-01', 15)
    const invoice = await makeInvoice(client.id, '2026-11-16')
    await makeInvoice(client.id, '2026-10-16', { paymentStatus: 'unpaid', correctsRecordId: invoice.id, amount: '-100.00' })
    expect((await buildBillingState(client))?.paying).toBe(false)
    await db.insert(invoicePayments).values({ recordId: invoice.id, amount: '40.00', currency: 'RON', paidAt: '2026-11-10', method: 'bank' })
    expect((await buildBillingState(client))?.paying).toBe(true)
  })

  it('is null for a client with no cadence', async () => {
    expect(await buildBillingState(await makeClient(null, 15))).toBeNull()
  })
})
