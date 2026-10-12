/**
 * Integration test — pg real (test/setup.ts). VAPID neconfigurat în test env →
 * notifyPush face no-op silențios, dar reminderSentAt tot trebuie actualizat
 * (job-ul nu depinde de succesul trimiterii push, doar de dedup pe ocurență).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../shared/db/client.js'
import { calendarEvents } from '../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../shared/testing/users.js'
import { runCalendarReminders } from './calendar-reminders.js'

const eventIds: string[] = []
const userIds: string[] = []
const qa = await createTestUser('reminders', userIds)

afterAll(async () => {
  if (eventIds.length) await db.delete(calendarEvents).where(inArray(calendarEvents.id, eventIds))
  await cleanupTestUsers(userIds)
})

async function eventById(id: string) {
  const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id))
  return row
}

describe('runCalendarReminders', () => {
  it('notifică + setează reminderSentAt pt. un eveniment în fereastra de reminder', async () => {
    const startAt = new Date(Date.now() + 10 * 60_000) // în 10 min
    const [row] = await db
      .insert(calendarEvents)
      .values({
        ownerUserId: qa.id,
        title: 'QA reminder event',
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        reminderMinutesBefore: 15,
      })
      .returning()
    eventIds.push(row!.id)

    await runCalendarReminders()

    const updated = await eventById(row!.id)
    expect(updated?.reminderSentAt?.getTime()).toBe(startAt.getTime())
  })

  it('nu notifică dacă ocurența e în afara ferestrei reminderMinutesBefore', async () => {
    const startAt = new Date(Date.now() + 45 * 60_000) // în 45 min
    const [row] = await db
      .insert(calendarEvents)
      .values({
        ownerUserId: qa.id,
        title: 'QA reminder too far',
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        reminderMinutesBefore: 15, // fereastra e doar 15 min — 45 min e prea devreme
      })
      .returning()
    eventIds.push(row!.id)

    await runCalendarReminders()

    const updated = await eventById(row!.id)
    expect(updated?.reminderSentAt).toBeNull()
  })

  it('dedup: a doua rulare nu re-notifică aceeași ocurență', async () => {
    const startAt = new Date(Date.now() + 5 * 60_000)
    const [row] = await db
      .insert(calendarEvents)
      .values({
        ownerUserId: qa.id,
        title: 'QA reminder dedup',
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        reminderMinutesBefore: 15,
      })
      .returning()
    eventIds.push(row!.id)

    await runCalendarReminders()
    const firstRun = await eventById(row!.id)
    await runCalendarReminders()
    const secondRun = await eventById(row!.id)

    expect(secondRun?.reminderSentAt?.getTime()).toBe(firstRun?.reminderSentAt?.getTime())
  })

  it('ignoră evenimentele fără reminderMinutesBefore', async () => {
    const startAt = new Date(Date.now() + 5 * 60_000)
    const [row] = await db
      .insert(calendarEvents)
      .values({
        ownerUserId: qa.id,
        title: 'QA no reminder configured',
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
      })
      .returning()
    eventIds.push(row!.id)

    await expect(runCalendarReminders()).resolves.not.toThrow()

    const updated = await eventById(row!.id)
    expect(updated?.reminderSentAt).toBeNull()
  })

  it('nu blochează alte evenimente dacă unul are RRULE malformat (failure izolat)', async () => {
    const startAt = new Date(Date.now() + 5 * 60_000)
    const [broken] = await db
      .insert(calendarEvents)
      .values({
        ownerUserId: qa.id,
        title: 'QA broken rrule',
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        reminderMinutesBefore: 15,
        recurrenceRule: 'NOT-A-VALID-RRULE',
      })
      .returning()
    eventIds.push(broken!.id)

    const [good] = await db
      .insert(calendarEvents)
      .values({
        ownerUserId: qa.id,
        title: 'QA good event after broken',
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        reminderMinutesBefore: 15,
      })
      .returning()
    eventIds.push(good!.id)

    await expect(runCalendarReminders()).resolves.not.toThrow()

    const updatedGood = await eventById(good!.id)
    expect(updatedGood?.reminderSentAt?.getTime()).toBe(startAt.getTime())
  })
})
