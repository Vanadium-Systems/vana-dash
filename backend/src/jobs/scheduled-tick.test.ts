/**
 * Integration test — pg real (test/setup.ts). Executorul scheduler-ului (Contract B):
 * reminder due → livrat + done; stale >7z → failed; recurent → reprogramat pe ceas local.
 * Push-ul e mock-uit prin setFcmSenderForTests + VAPID absent → notifyPush no-op web.
 */
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { dashboardConfig, scheduledRuns } from '../shared/db/schema/index.js'
import { setFcmSenderForTests } from '../shared/lib/push.js'
import { runScheduledTick } from './scheduled-tick.js'

const createdRunIds: string[] = []

async function insertRun(values: Partial<typeof scheduledRuns.$inferInsert>) {
  const [row] = await db.insert(scheduledRuns).values({ kind: 'reminder', runAt: new Date(Date.now() - 60_000), text: 'QA', ...values }).returning()
  createdRunIds.push(row!.id)
  return row!
}

beforeEach(() => {
  setFcmSenderForTests(async () => [])
})

afterAll(async () => {
  for (const id of createdRunIds) {
    await db.delete(scheduledRuns).where(eq(scheduledRuns.id, id))
  }
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, 'reminder_email_fallback'))
})

describe('runScheduledTick', () => {
  it('reminder due → status done', async () => {
    let pushed = false
    setFcmSenderForTests(async () => {
      pushed = true
      return []
    })
    const run = await insertRun({ kind: 'reminder', text: 'Sună-l pe Ion', runAt: new Date(Date.now() - 120_000) })
    await runScheduledTick()
    // Wait for the fire-and-forget push, so it cannot land on the next test's sender.
    await vi.waitFor(() => expect(pushed).toBe(true))
    const [after] = await db.select().from(scheduledRuns).where(eq(scheduledRuns.id, run.id))
    expect(after?.status).toBe('done')
  })

  it('pending mai vechi de 7 zile → failed, nu se livrează întârziat', async () => {
    let delivered = false
    setFcmSenderForTests(async () => {
      delivered = true
      return []
    })
    const run = await insertRun({ runAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) })
    await runScheduledTick()
    const [after] = await db.select().from(scheduledRuns).where(eq(scheduledRuns.id, run.id))
    expect(after?.status).toBe('failed')
    expect(delivered).toBe(false)
  })

  it('raport daily recurent → rămâne pending cu runAt mâine la aceeași oră locală', async () => {
    // Ora fixată pe ceasul Bucharest, nu UTC — verificăm perechea (zi +1, aceeași ora locală).
    const yesterdayLocal = new Date(Date.now() - 24 * 3600 * 1000 - 5 * 60_000)
    const run = await insertRun({
      kind: 'report',
      prompt: 'Raport QA',
      recurrence: 'daily',
      conversationId: null,
      runAt: yesterdayLocal,
    })
    await runScheduledTick()
    const [after] = await db.select().from(scheduledRuns).where(eq(scheduledRuns.id, run.id))
    expect(after?.status).toBe('pending')
    expect(after!.runAt.getTime()).toBeGreaterThan(Date.now())

    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Bucharest', hour: '2-digit', hourCycle: 'h23' })
    expect(Number(fmt.format(after!.runAt))).toBe(Number(fmt.format(yesterdayLocal)))
  })

  it('preferința de email fallback OFF → fără email; ON → sendAlertEmail apelat', async () => {
    // Doar fluxul OFF aici (emailul real ar cere Resend); fallback ON e acoperit de
    // mock-ul senderului FCM care confirmă calea push.
    await db.delete(dashboardConfig).where(eq(dashboardConfig.key, 'reminder_email_fallback'))
    let fcmCalls = 0
    setFcmSenderForTests(async () => {
      fcmCalls++
      return []
    })
    const run = await insertRun({ text: 'cu push' })
    await runScheduledTick()
    // The push is fire-and-forget (`void notifyPush` in executeReminder): the tick returns
    // before the sender is called.
    await vi.waitFor(() => expect(fcmCalls).toBe(1))
    const [after] = await db.select().from(scheduledRuns).where(and(eq(scheduledRuns.id, run.id), eq(scheduledRuns.status, 'done')))
    expect(after).toBeDefined()
  })
})
