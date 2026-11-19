/**
 * jobs/billing-cycle-rollover.ts — Sprint C, Track D: cadență de facturare recurentă + remindere
 * client, mutate integral din vanagreen. Integration test, pg real pt. `billing_clients`;
 * `sendEmail` mockuit la graniță.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { billingClients, financialRecords } from '../shared/db/schema/index.js'

const sendEmailMock = vi.fn()
vi.mock('../shared/lib/email.js', () => ({ sendEmail: (...args: unknown[]) => sendEmailMock(...args) }))

const { runBillingCycleRolloverJob } = await import('./billing-cycle-rollover.js')

const clientIds: string[] = []

function isoDaysFromToday(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function makeClient(overrides: Partial<typeof billingClients.$inferInsert>) {
  const [row] = await db
    .insert(billingClients)
    .values({
      name: 'Cycle QA Client',
      cif: `RO${Math.floor(Math.random() * 1e8)}`,
      address: 'x',
      email: 'client@example.com',
      ...overrides,
    })
    .returning()
  clientIds.push(row!.id)
  return row!
}

beforeEach(() => {
  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue(undefined)
})

async function makeInvoice(billingClientId: string, dueInDays: number, opts: { paid?: boolean; draft?: boolean } = {}) {
  const dueAt = new Date(`${isoDaysFromToday(dueInDays)}T12:00:00.000Z`)
  await db.insert(financialRecords).values({
    type: 'invoice',
    direction: 'out',
    amount: '100.00',
    currency: 'RON',
    source: 'generated',
    billingClientId,
    issuedAt: new Date(dueAt.getTime() - 15 * 24 * 60 * 60 * 1000),
    dueAt,
    documentNumber: opts.draft ? null : `TST-${Math.floor(Math.random() * 1e9)}`,
    paymentStatus: opts.paid ? 'paid' : 'unpaid',
  })
}

afterEach(async () => {
  if (clientIds.length) await db.delete(financialRecords).where(inArray(financialRecords.billingClientId, clientIds))
  if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
})

afterAll(() => vi.restoreAllMocks())

describe('runBillingCycleRolloverJob — roll-forward', () => {
  it('rolls a lapsed monthly cycle forward and resets reminder timestamps, skips reminder this run', async () => {
    const client = await makeClient({
      billingCycle: 'monthly',
      billingCycleDay: 1,
      billingDueDate: isoDaysFromToday(-3), // expirat
      billingOverdueSentAt: new Date(),
    })

    await runBillingCycleRolloverJob()

    const [updated] = await db.select().from(billingClients).where(inArray(billingClients.id, [client.id]))
    expect(updated?.billingDueDate).not.toBe(client.billingDueDate)
    expect(updated?.billingOverdueSentAt).toBeNull()
    expect(sendEmailMock).not.toHaveBeenCalled() // data tocmai s-a rostogolit, nu trimite azi
  })

  it('does NOT roll a one-shot client (no billingCycle) even if lapsed', async () => {
    const client = await makeClient({ billingCycle: null, billingDueDate: isoDaysFromToday(-3) })
    await runBillingCycleRolloverJob()
    const [updated] = await db.select().from(billingClients).where(inArray(billingClients.id, [client.id]))
    expect(updated?.billingDueDate).toBe(client.billingDueDate)
  })
})

describe('runBillingCycleRolloverJob — remindere', () => {
  // Reminders count down to the due day of the oldest unpaid invoice, not to billingDueDate (the
  // next invoice day): an invoice issued on the 1st and due on the 16th is late from the 17th.
  it('sends an overdue reminder the day after the oldest unpaid invoice was due, with that date', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(12) })
    await makeInvoice(client.id, -1)
    await runBillingCycleRolloverJob()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const arg = sendEmailMock.mock.calls[0]![0] as { to: string; subject: string; text: string }
    expect(arg.to).toBe('client@example.com')
    expect(arg.subject).toContain('restantă')
    expect(arg.text).toContain(isoDaysFromToday(-1))
    const [updated] = await db.select().from(billingClients).where(inArray(billingClients.id, [client.id]))
    expect(updated?.billingOverdueSentAt).not.toBeNull()
  })

  it('does not call an invoice overdue on its due day', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(12) })
    await makeInvoice(client.id, 0)
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('sends a 1-day reminder exactly one day before the invoice is due', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(20) })
    await makeInvoice(client.id, 1)
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('sends a 7-day reminder exactly seven days before the invoice is due', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(20) })
    await makeInvoice(client.id, 7)
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('sends nothing while nothing is owed, even 7 days before the next invoice day', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(7) })
    await makeInvoice(client.id, -10, { paid: true })
    await makeInvoice(client.id, -3, { draft: true })
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('is idempotent: does not re-send an overdue reminder already marked as sent', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(12), billingOverdueSentAt: new Date() })
    await makeInvoice(client.id, -1)
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips clients with no email (does not crash, no send attempted)', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(12), email: null })
    await makeInvoice(client.id, -1)
    await expect(runBillingCycleRolloverJob()).resolves.not.toThrow()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('CRITICAL — per-client error isolation: one send failure does not stop the rest of the batch', async () => {
    const clientA = await makeClient({ billingDueDate: isoDaysFromToday(12), email: 'a@example.com' })
    const clientB = await makeClient({ billingDueDate: isoDaysFromToday(12), email: 'b@example.com' })
    await makeInvoice(clientA.id, -1)
    await makeInvoice(clientB.id, -1)
    sendEmailMock.mockImplementation(async (opts: { to: string }) => {
      if (opts.to === 'a@example.com') throw new Error('resend down')
    })

    await expect(runBillingCycleRolloverJob()).resolves.not.toThrow()
    expect(sendEmailMock).toHaveBeenCalledTimes(2)

    const [updatedA] = await db.select().from(billingClients).where(inArray(billingClients.id, [clientA.id]))
    expect(updatedA?.billingOverdueSentAt).toBeNull() // clientul A a picat la send, nu s-a marcat
  })
})
