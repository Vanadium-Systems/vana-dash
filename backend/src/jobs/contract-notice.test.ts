import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { and, eq, like } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { addMonths, syncNoticeEvent } from '../modules/contracts/registry-service.js'
import { db } from '../shared/db/client.js'
import { alertRules, alerts, auditLog, calendarEvents, contracts, roles, users } from '../shared/db/schema/index.js'
import { getCompany } from '../shared/lib/company.js'
import { zonedTimeToUtc } from '../shared/lib/schedule-recurrence.js'
import { runContractNotice } from './contract-notice.js'

// The alert would send a real email and a push.
vi.mock('../shared/lib/email.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/lib/email.js')>()), sendAlertEmail: vi.fn() }))
vi.mock('../shared/lib/push.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/lib/push.js')>()), notifyPush: vi.fn() }))

const RUN = randomUUID().slice(0, 8)
const [role] = await db.insert(roles).values({ name: `QA notice ${RUN}`, kind: 'custom', features: [] }).returning()
const [owner] = await db
  .insert(users)
  .values({ email: `notice-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: 'QA notice', roleId: role!.id })
  .returning()

const today = new Date().toISOString().slice(0, 10)
const shiftDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function makeContract(label: string, values: Partial<typeof contracts.$inferInsert>) {
  const [row] = await db
    .insert(contracts)
    .values({
      title: `Notice ${label} ${RUN}`,
      category: 'other',
      counterpartyKind: 'other',
      counterpartyName: 'Acme SRL',
      ownerUserId: owner!.id,
      status: 'signed',
      origin: 'uploaded',
      ...values,
    })
    .returning()
  return row!
}

const reload = async (id: string) => (await db.select().from(contracts).where(eq(contracts.id, id)))[0]!

afterAll(async () => {
  const owned = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.ownerUserId, owner!.id))
  for (const { id } of owned) await db.delete(auditLog).where(eq(auditLog.entityId, id))
  await db.delete(alerts).where(like(alerts.message, `%${RUN}%`))
  await db.delete(calendarEvents).where(eq(calendarEvents.ownerUserId, owner!.id))
  await db.delete(contracts).where(eq(contracts.ownerUserId, owner!.id))
  await db.delete(users).where(eq(users.id, owner!.id))
  await db.delete(roles).where(eq(roles.id, role!.id))
})

describe('runContractNotice', () => {
  it('raises one alert per term, however often it runs', async () => {
    const endsOn = shiftDays(today, 20)
    const contract = await makeContract('alert', { endsOn, noticeDays: 10 })
    await runContractNotice(today)
    await runContractNotice(today)

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, 'contracts.notice'))
    const raised = await db.select().from(alerts).where(and(eq(alerts.ruleId, rule!.id), like(alerts.message, `%${RUN}%`)))
    expect(raised).toHaveLength(1)
    expect((await reload(contract.id)).noticeAlertedFor).toBe(endsOn)
  })

  it('rolls an auto-renewing contract forward by its renewal months', async () => {
    const endsOn = shiftDays(today, -1)
    const contract = await makeContract('renew', { endsOn, autoRenew: true, renewalMonths: 12 })
    await runContractNotice(today)
    expect((await reload(contract.id)).endsOn).toBe(addMonths(endsOn, 12))
  })

  it('expires a contract without renewal and removes its calendar event', async () => {
    const contract = await makeContract('expire', { endsOn: shiftDays(today, -1), noticeDays: 5 })
    await db.transaction((tx) => syncNoticeEvent(tx, contract.id))
    const eventId = (await reload(contract.id)).noticeEventId
    expect(eventId).toBeTruthy()

    await runContractNotice(today)
    const after = await reload(contract.id)
    expect(after.status).toBe('expired')
    expect(after.noticeEventId).toBeNull()
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId!))
    expect(event?.deletedAt).toBeTruthy()
  })

  it('puts the notice event at 09:00 on the company clock, summer and winter', async () => {
    const { timeZone } = await getCompany()
    const startOf = async (label: string, endsOn: string, deadline: [number, number, number]) => {
      const contract = await makeContract(label, { endsOn, noticeDays: 10 })
      await db.transaction((tx) => syncNoticeEvent(tx, contract.id))
      const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, (await reload(contract.id)).noticeEventId!))
      expect(event!.startAt).toEqual(zonedTimeToUtc(...deadline, 9, 0, timeZone))
      return event!.startAt
    }
    const summer = await startOf('summer', '2030-07-20', [2030, 7, 10])
    const winter = await startOf('winter', '2030-01-20', [2030, 1, 10])
    if (timeZone === 'Europe/Bucharest') {
      expect(summer.toISOString()).toBe('2030-07-10T06:00:00.000Z')
      expect(winter.toISOString()).toBe('2030-01-10T07:00:00.000Z')
    }
  })
})
