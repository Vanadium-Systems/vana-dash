/**
 * jobs/billing-cycle-rollover.ts — Sprint C, Track D: cadență de facturare recurentă + remindere
 * client, mutate integral din vanagreen. Integration test, pg real pt. `billing_clients`;
 * `sendEmail` mockuit la graniță.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { billingClients } from '../shared/db/schema/index.js'

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

afterEach(async () => {
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
  it('sends an overdue reminder for a lapsed one-shot client with no prior overdue email', async () => {
    const client = await makeClient({ billingDueDate: isoDaysFromToday(-1) })
    await runBillingCycleRolloverJob()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const arg = sendEmailMock.mock.calls[0]![0] as { to: string; subject: string }
    expect(arg.to).toBe('client@example.com')
    const [updated] = await db.select().from(billingClients).where(inArray(billingClients.id, [client.id]))
    expect(updated?.billingOverdueSentAt).not.toBeNull()
  })

  it('sends a 1-day reminder exactly at daysUntilDue === 1', async () => {
    await makeClient({ billingDueDate: isoDaysFromToday(1) })
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('sends a 7-day reminder exactly at daysUntilDue === 7', async () => {
    await makeClient({ billingDueDate: isoDaysFromToday(7) })
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: does not re-send an overdue reminder already marked as sent', async () => {
    await makeClient({ billingDueDate: isoDaysFromToday(-1), billingOverdueSentAt: new Date() })
    await runBillingCycleRolloverJob()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips clients with no email (does not crash, no send attempted)', async () => {
    await makeClient({ billingDueDate: isoDaysFromToday(-1), email: null })
    await expect(runBillingCycleRolloverJob()).resolves.not.toThrow()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('CRITICAL — per-client error isolation: one send failure does not stop the rest of the batch', async () => {
    const clientA = await makeClient({ billingDueDate: isoDaysFromToday(-1), email: 'a@example.com' })
    await makeClient({ billingDueDate: isoDaysFromToday(-1), email: 'b@example.com' })
    sendEmailMock.mockImplementation(async (opts: { to: string }) => {
      if (opts.to === 'a@example.com') throw new Error('resend down')
    })

    await expect(runBillingCycleRolloverJob()).resolves.not.toThrow()
    expect(sendEmailMock).toHaveBeenCalledTimes(2)

    const [updatedA] = await db.select().from(billingClients).where(inArray(billingClients.id, [clientA.id]))
    expect(updatedA?.billingOverdueSentAt).toBeNull() // clientul A a picat la send, nu s-a marcat
  })
})
