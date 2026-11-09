/**
 * modules/calendar/service.ts — integration test, pg real (test/setup.ts).
 * 2026-07-20 e o zi de luni (verificat) — folosit ca ancoră fixă pt. toate testele de
 * recurență, ca să nu depindă de data la care rulează suite-ul.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { calendarEventExceptions, calendarEventReminders, calendarEvents, recurringExpenses } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { createEvent, deleteEvent, duplicateEvent, listOccurrences, revertWrite, updateEvent } from './service.js'

const MON = new Date('2026-07-20T09:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const eventIds: string[] = []
const expenseIds: string[] = []
const userIds: string[] = []

// Calendar per om (Wave 6): evenimentele au un proprietar, deci listarea primește omul.
const qa = await createTestUser('calendar principal', userIds, { features: ['facturi.cheltuieli'] })
const coleg = await createTestUser('calendar coleg', userIds)

async function makeEvent(input: Omit<Parameters<typeof createEvent>[1], 'me'>, me = qa) {
  // `!` — pattern identic modules/pricing/service.test.ts (vezi nota din archive/service.test.ts).
  const row = (await createEvent(me, input)).data
  eventIds.push(row.id)
  return row
}

// Insert direct pe tabelă (nu prin modules/accounting/service.ts — cross-import interzis între
// module, regula #5 CLAUDE.md; calendar/service.ts însuși citește direct din recurring_expenses,
// exact ca schema-level access, nu modul-la-modul).
async function makeRecurringExpense(overrides: Partial<typeof recurringExpenses.$inferInsert> = {}) {
  const [row] = await db
    .insert(recurringExpenses)
    .values({
      description: 'QA cheltuială recurentă',
      amount: '99.99',
      currency: 'RON',
      cycle: 'monthly',
      cycleDay: 20,
      nextDueDate: '2026-07-20',
      active: true,
      showInCalendar: true,
      ...overrides,
    })
    .returning()
  expenseIds.push(row!.id)
  return row!
}

afterAll(async () => {
  if (eventIds.length) await db.delete(calendarEvents).where(inArray(calendarEvents.id, eventIds))
  if (expenseIds.length) await db.delete(recurringExpenses).where(inArray(recurringExpenses.id, expenseIds))
  await cleanupTestUsers(userIds)
})

describe('evenimente unice (fără recurrenceRule)', () => {
  it('un eveniment în interiorul ferestrei apare o singură dată', async () => {
    const event = await makeEvent({
      title: 'QA Eveniment unic',
      startAt: MON,
      endAt: new Date(MON.getTime() + 60 * 60 * 1000),
    })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    const mine = occurrences.filter((o) => o.eventId === event.id)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.isRecurring).toBe(false)
  })

  it('un eveniment complet în afara ferestrei nu apare', async () => {
    const event = await makeEvent({
      title: 'QA Eveniment în afara ferestrei',
      startAt: new Date('2026-08-15T09:00:00.000Z'),
      endAt: new Date('2026-08-15T10:00:00.000Z'),
    })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === event.id)).toBe(false)
  })
})

describe('evenimente recurente (RRULE)', () => {
  it('FREQ=WEEKLY;BYDAY=MO,WE,FR generează exact 3 ocurențe într-o fereastră de-o săptămână', async () => {
    const event = await makeEvent({
      title: 'QA Recurent Mon/Wed/Fri',
      startAt: MON,
      endAt: new Date(MON.getTime() + 3 * 60 * 60 * 1000),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-27T00:00:00.000Z'))
    const mine = occurrences.filter((o) => o.eventId === event.id)
    expect(mine).toHaveLength(3)
    expect(mine.every((o) => o.isRecurring)).toBe(true)
    expect(mine.map((o) => o.occurrenceStart.slice(0, 10))).toEqual(['2026-07-20', '2026-07-22', '2026-07-24'])
  })

  it('recurrenceEndAt înainte de fereastra cerută → evenimentul nu apare deloc', async () => {
    const event = await makeEvent({
      title: 'QA Recurent expirat',
      startAt: MON,
      endAt: new Date(MON.getTime() + 60 * 60 * 1000),
      recurrenceRule: 'FREQ=DAILY',
      recurrenceEndAt: new Date('2026-07-21T00:00:00.000Z'),
    })

    const occurrences = await listOccurrences(qa, new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-08T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === event.id)).toBe(false)
  })

  it('recurrenceEndAt la mijlocul ferestrei → doar ocurențele până la limită', async () => {
    const event = await makeEvent({
      title: 'QA Recurent cu capăt la mijloc',
      startAt: MON,
      endAt: new Date(MON.getTime() + 60 * 60 * 1000),
      recurrenceRule: 'FREQ=DAILY',
      recurrenceEndAt: new Date('2026-07-22T23:59:59.000Z'),
    })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-27T00:00:00.000Z'))
    const mine = occurrences.filter((o) => o.eventId === event.id)
    expect(mine.map((o) => o.occurrenceStart.slice(0, 10))).toEqual(['2026-07-20', '2026-07-21', '2026-07-22'])
  })

  it('fără recurrenceEndAt (recurență infinită) → generează ocurențe și mult mai târziu', async () => {
    const event = await makeEvent({
      title: 'QA Recurent fără capăt',
      startAt: MON,
      endAt: new Date(MON.getTime() + 60 * 60 * 1000),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    })

    const occurrences = await listOccurrences(qa, new Date('2027-01-01T00:00:00.000Z'), new Date('2027-01-08T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === event.id)).toBe(true)
  })
})

describe('update / delete', () => {
  it('updateEvent modifică titlul, reflectat în ocurențele viitoare', async () => {
    const event = await makeEvent({
      title: 'QA Titlu inițial',
      startAt: MON,
      endAt: new Date(MON.getTime() + 60 * 60 * 1000),
    })
    await updateEvent(qa, event.id, { title: 'QA Titlu actualizat' })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    expect(occurrences.find((o) => o.eventId === event.id)?.title).toBe('QA Titlu actualizat')
  })

  it('updateEvent pe un eveniment deja șters (soft) întoarce undefined, nu-l "resuscită"', async () => {
    const event = await makeEvent({
      title: 'QA Update pe eveniment șters',
      startAt: MON,
      endAt: new Date(MON.getTime() + 60 * 60 * 1000),
    })
    await deleteEvent(qa, event.id)
    // null, nu undefined: un eveniment șters nu mai e nici „găsit" (loadEvent filtrează
    // deleted_at), iar ruta tratează orice fals la fel — 404, nu „resuscitare".
    const result = await updateEvent(qa, event.id, { title: 'nu ar trebui să meargă' })
    expect(result).toBeNull()
  })

  it('deleteEvent (soft) elimină evenimentul din listOccurrences', async () => {
    const event = await makeEvent({
      title: 'QA De șters',
      startAt: MON,
      endAt: new Date(MON.getTime() + 60 * 60 * 1000),
    })
    await deleteEvent(qa, event.id)

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === event.id)).toBe(false)
  })
})

async function makeWeeklySeries(title: string) {
  return makeEvent({ title, startAt: MON, endAt: new Date(MON.getTime() + HOUR_MS), recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' })
}

// Four Mondays: 07-20, 07-27, 08-03, 08-10.
const WINDOW_FROM = new Date('2026-07-20T00:00:00.000Z')
const WINDOW_TO = new Date('2026-08-17T00:00:00.000Z')
const keyOf = (week: number) => new Date(MON.getTime() + week * 7 * DAY_MS)

describe('serii: scope pe update / delete', () => {
  it('fără scope, update și delete pe o serie sunt respinse cu SCOPE_REQUIRED', async () => {
    const series = await makeWeeklySeries('QA Serie fără scope')
    await expect(updateEvent(qa, series.id, { title: 'nu' })).rejects.toMatchObject({ code: 'SCOPE_REQUIRED' })
    await expect(deleteEvent(qa, series.id)).rejects.toMatchObject({ code: 'SCOPE_REQUIRED' })
  })

  it('deleteEvent cu scope occurrence ascunde exact acea ocurență', async () => {
    const series = await makeWeeklySeries('QA Serie, o ocurență ștearsă')
    await deleteEvent(qa, series.id, { scope: 'occurrence', occurrence: keyOf(1) })

    const mine = (await listOccurrences(qa, WINDOW_FROM, WINDOW_TO)).filter((o) => o.eventId === series.id)
    expect(mine.map((o) => o.occurrenceStart.slice(0, 10))).toEqual(['2026-07-20', '2026-08-03', '2026-08-10'])
  })

  it('updateEvent cu scope occurrence și startAt nou mută ocurența și o marchează ca excepție', async () => {
    const series = await makeWeeklySeries('QA Serie, o ocurență mutată')
    const moved = new Date(keyOf(1).getTime() + DAY_MS + 2 * HOUR_MS)
    await updateEvent(qa, series.id, { startAt: moved, endAt: new Date(moved.getTime() + HOUR_MS) }, { scope: 'occurrence', occurrence: keyOf(1) })

    const mine = (await listOccurrences(qa, WINDOW_FROM, WINDOW_TO)).filter((o) => o.eventId === series.id)
    expect(mine).toHaveLength(4)
    const shown = mine.find((o) => o.occurrenceKey === keyOf(1).toISOString())
    expect(shown?.occurrenceStart).toBe(moved.toISOString())
    expect(shown?.isException).toBe(true)
  })

  it('scope following de la a 3-a ocurență: seria veche se oprește, una nouă începe cu titlul nou și preia excepția de după', async () => {
    const series = await makeWeeklySeries('QA Serie împărțită')
    await updateEvent(qa, series.id, { title: 'QA Doar a 4-a' }, { scope: 'occurrence', occurrence: keyOf(3) })
    const split = (await updateEvent(qa, series.id, { title: 'QA Serie nouă' }, { scope: 'following', occurrence: keyOf(2) }))!.data
    eventIds.push(split.id)

    const [old] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, series.id))
    expect(old!.title).toBe('QA Serie împărțită')
    expect(old!.recurrenceEndAt!.getTime()).toBeLessThan(keyOf(2).getTime())
    expect(split.title).toBe('QA Serie nouă')
    expect(split.startAt.toISOString()).toBe(keyOf(2).toISOString())

    const [exception] = await db.select().from(calendarEventExceptions).where(eq(calendarEventExceptions.occurrenceStart, keyOf(3)))
    expect(exception?.eventId).toBe(split.id)
    const occurrences = await listOccurrences(qa, WINDOW_FROM, WINDOW_TO)
    expect(occurrences.filter((o) => o.eventId === series.id).map((o) => o.occurrenceStart.slice(0, 10))).toEqual(['2026-07-20', '2026-07-27'])
    expect(occurrences.filter((o) => o.eventId === split.id).map((o) => o.title)).toEqual(['QA Serie nouă', 'QA Doar a 4-a'])
  })

  it('revertWrite după split readuce seria originală; tokenul merge o dată și doar pentru autor', async () => {
    const series = await makeWeeklySeries('QA Serie de revenit')
    await updateEvent(qa, series.id, { title: 'QA Doar a 4-a, revert' }, { scope: 'occurrence', occurrence: keyOf(3) })
    const result = (await updateEvent(qa, series.id, { title: 'QA Titlu nou, revert' }, { scope: 'following', occurrence: keyOf(2) }))!
    eventIds.push(result.data.id)

    expect(await revertWrite(coleg, result.revertToken)).toBe(false)
    expect(await revertWrite(qa, result.revertToken)).toBe(true)
    expect(await revertWrite(qa, result.revertToken)).toBe(false)

    expect(await db.select().from(calendarEvents).where(eq(calendarEvents.id, result.data.id))).toHaveLength(0)
    const [restored] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, series.id))
    expect(restored!.title).toBe('QA Serie de revenit')
    expect(restored!.recurrenceEndAt).toBeNull()
    const exceptions = await db
      .select()
      .from(calendarEventExceptions)
      .where(and(eq(calendarEventExceptions.occurrenceStart, keyOf(3)), inArray(calendarEventExceptions.eventId, [series.id, result.data.id])))
    expect(exceptions.map((e) => e.eventId)).toEqual([series.id])
  })

  it('mutarea unei serii săptămânale de luni cu o zi, scope all, rotește BYDAY la TU', async () => {
    const series = await makeWeeklySeries('QA Serie mutată pe marți')
    const tuesday = new Date(MON.getTime() + DAY_MS)
    const updated = (await updateEvent(qa, series.id, { startAt: tuesday, endAt: new Date(tuesday.getTime() + HOUR_MS) }, { scope: 'all' }))!
    expect(updated.data.recurrenceRule).toContain('BYDAY=TU')
  })
})

describe('remindere multiple', () => {
  const remindersOf = (eventId: string) => db.select().from(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId))

  it('createEvent cu reminders [10, 60] salvează două rânduri; update cu [60] păstrează rândul de 60', async () => {
    const event = await makeEvent({ title: 'QA Remindere', startAt: MON, endAt: new Date(MON.getTime() + HOUR_MS), reminders: [10, 60] })
    const created = await remindersOf(event.id)
    expect(created.map((r) => r.minutesBefore).sort((a, b) => a - b)).toEqual([10, 60])
    const sixty = created.find((r) => r.minutesBefore === 60)!

    await updateEvent(qa, event.id, { reminders: [60] })
    const after = await remindersOf(event.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.id).toBe(sixty.id)
  })

  it('reminderMinutesBefore vechi (15) devine reminders [15]', async () => {
    const event = await makeEvent({ title: 'QA Reminder vechi', startAt: MON, endAt: new Date(MON.getTime() + HOUR_MS), reminderMinutesBefore: 15 })
    expect((await remindersOf(event.id)).map((r) => r.minutesBefore)).toEqual([15])
  })
})

describe('duplicate', () => {
  it('duplicateEvent dintr-o ocurență a unei serii face o copie unică la ora ocurenței', async () => {
    const series = await makeWeeklySeries('QA Serie de duplicat')
    const copy = (await duplicateEvent(qa, series.id, keyOf(1)))!.data
    eventIds.push(copy.id)
    expect(copy.recurrenceRule).toBeNull()
    expect(copy.startAt.toISOString()).toBe(keyOf(1).toISOString())
    expect(copy.endAt.toISOString()).toBe(new Date(keyOf(1).getTime() + HOUR_MS).toISOString())
  })
})

describe('cheltuieli recurente (ocurențe virtuale din recurring_expenses)', () => {
  it('o cheltuială activă cu showInCalendar=true apare ca ocurență allDay în fereastra scadenței', async () => {
    const expense = await makeRecurringExpense({ description: 'QA Chirie', nextDueDate: '2026-07-20' })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    const mine = occurrences.find((o) => o.eventId === `expense-${expense.id}`)
    expect(mine).toBeDefined()
    expect(mine?.kind).toBe('expense')
    expect(mine?.allDay).toBe(true)
    expect(mine?.title).toContain('QA Chirie')
  })

  it('fără facturi.cheltuieli plățile recurente nu apar în calendar', async () => {
    const expense = await makeRecurringExpense({ description: 'QA Chirie ascunsă colegului', nextDueDate: '2026-07-20' })
    const occurrences = await listOccurrences(coleg, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === `expense-${expense.id}`)).toBe(false)
  })

  it('showInCalendar=false → nu apare, chiar dacă e activă și scadentă în fereastră', async () => {
    const expense = await makeRecurringExpense({ description: 'QA Ascunsă', nextDueDate: '2026-07-20', showInCalendar: false })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === `expense-${expense.id}`)).toBe(false)
  })

  it('active=false (pusă pe pauză) → nu apare, chiar dacă showInCalendar=true', async () => {
    const expense = await makeRecurringExpense({ description: 'QA Pauzată', nextDueDate: '2026-07-20', active: false })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === `expense-${expense.id}`)).toBe(false)
  })

  it('cadență lunară → generează o ocurență în fiecare lună din fereastră (nu doar prima)', async () => {
    const expense = await makeRecurringExpense({ description: 'QA Abonament lunar', cycle: 'monthly', cycleDay: 20, nextDueDate: '2026-07-20' })

    const occurrences = await listOccurrences(qa, new Date('2026-07-01T00:00:00.000Z'), new Date('2026-10-01T00:00:00.000Z'))
    const mine = occurrences.filter((o) => o.eventId === `expense-${expense.id}`)
    expect(mine.map((o) => o.occurrenceStart.slice(0, 10))).toEqual(['2026-07-20', '2026-08-20', '2026-09-20'])
  })

  it('scadență viitoare, în afara ferestrei cerute → nu apare', async () => {
    const expense = await makeRecurringExpense({ description: 'QA Prea departe', nextDueDate: '2027-01-15' })

    const occurrences = await listOccurrences(qa, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-27T00:00:00.000Z'))
    expect(occurrences.some((o) => o.eventId === `expense-${expense.id}`)).toBe(false)
  })
})
