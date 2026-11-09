/**
 * Integration test — pg real (test/setup.ts). VAPID neconfigurat în test env →
 * notifyPush face no-op silențios, dar `last_sent_occurrence` tot trebuie actualizat
 * (job-ul nu depinde de succesul trimiterii push, doar de dedup pe ocurență).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../shared/db/client.js'
import { calendarEventExceptions, calendarEventReminders, calendarEvents } from '../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../shared/testing/users.js'
import { runCalendarReminders } from './calendar-reminders.js'

const eventIds: string[] = []
const userIds: string[] = []
const qa = await createTestUser('reminders', userIds)

afterAll(async () => {
  if (eventIds.length) await db.delete(calendarEvents).where(inArray(calendarEvents.id, eventIds))
  await cleanupTestUsers(userIds)
})

async function makeEvent(values: Partial<typeof calendarEvents.$inferInsert> & { startAt: Date }, reminders: number[]) {
  const [row] = await db
    .insert(calendarEvents)
    .values({ ownerUserId: qa.id, title: 'QA reminder', endAt: new Date(values.startAt.getTime() + 30 * 60_000), ...values })
    .returning()
  eventIds.push(row!.id)
  if (reminders.length) await db.insert(calendarEventReminders).values(reminders.map((minutesBefore) => ({ eventId: row!.id, minutesBefore })))
  return row!
}

async function sentFor(eventId: string) {
  const rows = await db.select().from(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId))
  return Object.fromEntries(rows.map((r) => [r.minutesBefore, r.lastSentOccurrence?.getTime() ?? null]))
}

describe('runCalendarReminders', () => {
  it('notifică și marchează ocurența pe rândul de reminder din fereastră', async () => {
    const startAt = new Date(Date.now() + 10 * 60_000) // în 10 min
    const event = await makeEvent({ title: 'QA reminder event', startAt }, [15])

    await runCalendarReminders()

    expect(await sentFor(event.id)).toEqual({ 15: startAt.getTime() })
  })

  it('nu notifică dacă ocurența e în afara ferestrei reminderului', async () => {
    const startAt = new Date(Date.now() + 45 * 60_000) // în 45 min, fereastra e de 15
    const event = await makeEvent({ title: 'QA reminder too far', startAt }, [15])

    await runCalendarReminders()

    expect(await sentFor(event.id)).toEqual({ 15: null })
  })

  it('fiecare reminder are fereastra lui: 60 trimite, 5 încă nu', async () => {
    const startAt = new Date(Date.now() + 20 * 60_000)
    const event = await makeEvent({ title: 'QA two reminders', startAt }, [5, 60])

    await runCalendarReminders()

    expect(await sentFor(event.id)).toEqual({ 5: null, 60: startAt.getTime() })
  })

  it('dedup: a doua rulare nu re-notifică aceeași ocurență', async () => {
    const startAt = new Date(Date.now() + 5 * 60_000)
    const event = await makeEvent({ title: 'QA reminder dedup', startAt }, [15])

    await runCalendarReminders()
    const firstRun = await sentFor(event.id)
    await runCalendarReminders()

    expect(await sentFor(event.id)).toEqual(firstRun)
  })

  it('o ocurență anulată dintr-o serie nu notifică', async () => {
    const startAt = new Date(Date.now() + 5 * 60_000)
    startAt.setSeconds(0, 0)
    const event = await makeEvent({ title: 'QA cancelled occurrence', startAt, recurrenceRule: 'FREQ=DAILY' }, [15])
    await db.insert(calendarEventExceptions).values({ eventId: event.id, occurrenceStart: startAt, kind: 'cancelled' })

    await runCalendarReminders()

    expect(await sentFor(event.id)).toEqual({ 15: null })
  })

  it('nu blochează alte evenimente dacă unul are RRULE malformat (failure izolat)', async () => {
    const startAt = new Date(Date.now() + 5 * 60_000)
    await makeEvent({ title: 'QA broken rrule', startAt, recurrenceRule: 'NOT-A-VALID-RRULE' }, [15])
    const good = await makeEvent({ title: 'QA good event after broken', startAt }, [15])

    await expect(runCalendarReminders()).resolves.not.toThrow()

    expect(await sentFor(good.id)).toEqual({ 15: startAt.getTime() })
  })
})
