/**
 * modules/calendar/service.ts — integration test, pg real (test/setup.ts).
 * 2026-07-20 e o zi de luni (verificat) — folosit ca ancoră fixă pt. toate testele de
 * recurență, ca să nu depindă de data la care rulează suite-ul.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { calendarEvents, recurringExpenses } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { createEvent, deleteEvent, listOccurrences, updateEvent } from './service.js'

const MON = new Date('2026-07-20T09:00:00.000Z')
const eventIds: string[] = []
const expenseIds: string[] = []
const userIds: string[] = []

// Calendar per om (Wave 6): evenimentele au un proprietar, deci listarea primește omul.
const qa = await createTestUser('calendar principal', userIds)

async function makeEvent(input: Omit<Parameters<typeof createEvent>[1], 'me'>, me = qa) {
  // `!` — pattern identic modules/pricing/service.test.ts (vezi nota din archive/service.test.ts).
  const row = (await createEvent(me, input))!
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
