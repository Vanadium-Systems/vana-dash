import { inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db/client.js'
import { billingClients, financialRecords } from '../db/schema/index.js'
import { clientPaymentDueDate } from './client-payment-due.js'

const clientIds: string[] = []

async function makeClient(billingDueDate: string | null, paymentTermsDays: number | null) {
  const [row] = await db
    .insert(billingClients)
    .values({ name: 'Due QA Client', cif: `RO${Math.floor(Math.random() * 1e8)}`, address: 'x', billingDueDate, paymentTermsDays })
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
  await db.delete(financialRecords).where(inArray(financialRecords.billingClientId, clientIds))
  await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
})

describe('clientPaymentDueDate', () => {
  it('is the due day of the oldest unpaid invoice, whatever the next invoice day', async () => {
    const client = await makeClient('2026-12-01', 15)
    await makeInvoice(client.id, '2026-11-16')
    await makeInvoice(client.id, '2026-10-16')
    expect(await clientPaymentDueDate(client)).toBe('2026-10-16')
  })

  it('ignores paid invoices, drafts, deleted ones and stornos', async () => {
    const client = await makeClient('2026-12-01', 15)
    const original = await makeInvoice(client.id, '2026-08-16', { paymentStatus: 'paid' })
    await makeInvoice(client.id, '2026-09-16', { documentNumber: null })
    await makeInvoice(client.id, '2026-10-16', { deletedAt: new Date() })
    await makeInvoice(client.id, '2026-10-20', { amount: '-100.00', correctsRecordId: original.id })
    expect(await clientPaymentDueDate(client)).toBe('2026-12-16')
  })

  it('with nothing owed, is the next invoice day plus the payment terms', async () => {
    expect(await clientPaymentDueDate(await makeClient('2026-12-01', 15))).toBe('2026-12-16')
    expect(await clientPaymentDueDate(await makeClient('2026-12-30', 5))).toBe('2027-01-04')
    expect(await clientPaymentDueDate(await makeClient('2026-12-01', null))).toBe('2026-12-01')
  })

  it('is null for a client with no cadence and nothing owed', async () => {
    expect(await clientPaymentDueDate(await makeClient(null, 15))).toBeNull()
  })
})
