/**
 * Programări publice (docs/BOOKING.md): calculul pe calendarul real, rezervarea în tranzacție,
 * anularea prin token, purjarea la 90 de zile și rutele publice. Postgres real; emailul și
 * push-ul sunt mockuite la graniță.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { bookingBlocks, bookings, calendarEvents, dashboardConfig, users } from '../../shared/db/schema/index.js'
import type { BookingSettings } from './schema.js'

const sendEmailMock = vi.fn()
const notifyPushMock = vi.fn()
vi.mock('../../shared/lib/email.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))
vi.mock('../../shared/lib/push.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifyPush: (...args: unknown[]) => notifyPushMock(...args),
}))

const service = await import('./service.js')
const { buildServer } = await import('../../app.js')

// Luni 2031-03-03 → ora de iarnă, București = UTC+2. Departe de orice dată din DB-ul de dev.
const NOW = new Date('2031-03-02T18:00:00.000Z')
const MONDAY_10 = '2031-03-03T08:00:00.000Z'
const SETTINGS: BookingSettings = {
  enabled: true,
  durationMin: 30,
  bufferMin: 0,
  minNoticeHours: 0,
  horizonDays: 7,
  weekly: [{ weekday: 1, start: '10:00', end: '12:00' }],
}

let savedSettings: unknown
const eventIds: string[] = []
const blockIds: string[] = []

// Programările publice sunt ale lui Stefan, deci sloturile se calculează doar din calendarul
// lui — evenimentele de test trebuie puse pe același owner, altfel testul nu ar tăia fereastra.
const [bookingOwner] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.isPlatformAdmin, true))
  .limit(1)

beforeAll(async () => {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, 'booking.settings'))
  savedSettings = row?.value
})

beforeEach(async () => {
  await service.saveSettings(SETTINGS)
  sendEmailMock.mockReset()
  notifyPushMock.mockReset()
})

afterEach(async () => {
  const created = await db.select({ id: bookings.id, eventId: bookings.calendarEventId }).from(bookings).where(inArray(bookings.startAt, testStarts()))
  await db.delete(bookings).where(inArray(bookings.id, created.map((b) => b.id).concat('00000000-0000-0000-0000-000000000000')))
  const allEvents = [...eventIds, ...created.map((b) => b.eventId).filter((id): id is string => Boolean(id))]
  if (allEvents.length) await db.delete(calendarEvents).where(inArray(calendarEvents.id, allEvents))
  if (blockIds.length) await db.delete(bookingBlocks).where(inArray(bookingBlocks.id, blockIds))
  eventIds.length = 0
  blockIds.length = 0
})

afterAll(async () => {
  if (savedSettings === undefined) await db.delete(dashboardConfig).where(eq(dashboardConfig.key, 'booking.settings'))
  else await service.saveSettings(savedSettings as BookingSettings)
})

function testStarts(): Date[] {
  const starts: Date[] = []
  for (let i = 0; i < 4 * 24 * 7; i++) starts.push(new Date(new Date('2031-03-02T00:00:00.000Z').getTime() + i * 15 * 60_000))
  return starts
}

const visitor = { name: 'Ionescu Andrei', email: 'andrei@example.com', company: 'Acme SA', topic: 'Vrem să vedem VanaGreen', consent: true as const }

describe('sloturi pe calendarul real', () => {
  it('un eveniment săptămânal (RRULE) taie fereastra', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ ownerUserId: bookingOwner!.id, title: 'Sală', startAt: new Date('2031-02-24T08:30:00.000Z'), endAt: new Date('2031-02-24T09:30:00.000Z'), recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' })
      .returning()
    eventIds.push(event!.id)
    const { slots } = await service.getAvailableSlots(1, NOW)
    expect(slots.map((s) => s.start)).toEqual([MONDAY_10, '2031-03-03T09:30:00.000Z'])
  })

  it('un interval blocat din VanaDash nu apare pe site', async () => {
    const block = await service.createBlock({ startAt: new Date('2031-03-03T08:00:00.000Z'), endAt: new Date('2031-03-03T10:00:00.000Z') })
    blockIds.push(block!.id)
    expect((await service.getAvailableSlots(1, NOW)).slots).toEqual([])
  })

  it('nu expune niciodată titlul evenimentelor', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ ownerUserId: bookingOwner!.id, title: 'Consult medical', startAt: new Date('2031-03-03T09:00:00.000Z'), endAt: new Date('2031-03-03T09:30:00.000Z') })
      .returning()
    eventIds.push(event!.id)
    expect(JSON.stringify(await service.getAvailableSlots(1, NOW))).not.toContain('Consult')
  })
})

describe('rezervare', () => {
  it('două rezervări simultane pe același slot: una trece, cealaltă primește slot_taken', async () => {
    const results = await Promise.allSettled([
      service.createPublicBooking({ ...visitor, start: new Date(MONDAY_10) }, NOW),
      service.createPublicBooking({ ...visitor, email: 'b@example.com', start: new Date(MONDAY_10) }, NOW),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'slot_taken', status: 409 })
    const rows = await db.select().from(bookings).where(eq(bookings.startAt, new Date(MONDAY_10)))
    expect(rows).toHaveLength(1)
  })

  it('creează evenimentul în calendar și trimite confirmarea fără numele în push', async () => {
    const result = await service.createPublicBooking({ ...visitor, start: new Date(MONDAY_10) }, NOW)
    const [row] = await db.select().from(bookings).where(eq(bookings.id, result.bookingId))
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, row!.calendarEventId!))
    expect(event).toMatchObject({ title: 'Apel · Ionescu Andrei, Acme SA', source: 'booking' })
    expect(sendEmailMock).toHaveBeenCalledOnce()
    expect(sendEmailMock.mock.calls[0]![0].attachments[0].filename).toBe('programare.ics')
    expect(JSON.stringify(notifyPushMock.mock.calls)).not.toContain('Ionescu')
    // Slotul ocupat dispare din lista publică.
    expect((await service.getAvailableSlots(1, NOW)).slots.map((s) => s.start)).not.toContain(MONDAY_10)
  })

  it('refuză un slot care nu e în listă', async () => {
    await expect(service.createPublicBooking({ ...visitor, start: new Date('2031-03-03T08:10:00.000Z') }, NOW)).rejects.toMatchObject({ code: 'slot_taken' })
  })

  it('oprește a șasea rezervare din aceeași zi', async () => {
    await service.saveSettings({ ...SETTINGS, weekly: [{ weekday: 1, start: '08:00', end: '14:00' }] })
    const starts = ['06:00', '06:30', '07:00', '07:30', '08:00', '08:30'].map((t) => new Date(`2031-03-03T${t}:00.000Z`))
    const outcomes: string[] = []
    for (const start of starts) {
      try {
        await service.createPublicBooking({ ...visitor, start }, NOW)
        outcomes.push('ok')
      } catch (err) {
        outcomes.push((err as { code: string }).code)
      }
    }
    expect(outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'daily_cap'])
  })
})

describe('anulare prin token', () => {
  it('anulează, șterge evenimentul și nu mai merge a doua oară', async () => {
    await service.createPublicBooking({ ...visitor, start: new Date(MONDAY_10) }, NOW)
    const text: string = sendEmailMock.mock.calls[0]![0].text
    const token = decodeURIComponent(/\?t=([^\s]+)/.exec(text)![1]!)

    await expect(service.cancelByToken(token, NOW)).resolves.toMatchObject({ start: MONDAY_10 })
    const [row] = await db.select().from(bookings).where(eq(bookings.startAt, new Date(MONDAY_10)))
    expect(row!.status).toBe('cancelled')
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, row!.calendarEventId!))
    expect(event!.deletedAt).not.toBeNull()
    await expect(service.cancelByToken(token, NOW)).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })

  it('după începutul apelului răspunde too_late', async () => {
    await service.createPublicBooking({ ...visitor, start: new Date(MONDAY_10) }, NOW)
    const token = decodeURIComponent(/\?t=([^\s]+)/.exec(sendEmailMock.mock.calls[0]![0].text)![1]!)
    await expect(service.cancelByToken(token, new Date('2031-03-03T08:05:00.000Z'))).rejects.toMatchObject({ code: 'too_late', status: 410 })
  })

  it('un token necunoscut dă not_found', async () => {
    await expect(service.cancelByToken('a'.repeat(43), NOW)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('purjare la 90 de zile', () => {
  it('golește datele vizitatorului și anonimizează evenimentul', async () => {
    const result = await service.createPublicBooking({ ...visitor, start: new Date(MONDAY_10) }, NOW)
    // Cu o zi înainte de termen rămâne neatinsă (alte rezervări din DB-ul de dev pot fi purjate aici).
    await service.purgeExpiredBookings(new Date('2031-05-31T00:00:00.000Z'))
    const [before] = await db.select().from(bookings).where(eq(bookings.id, result.bookingId))
    expect(before!.name).toBe('Ionescu Andrei')
    await service.purgeExpiredBookings(new Date('2031-06-02T00:00:00.000Z'))
    const [row] = await db.select().from(bookings).where(eq(bookings.id, result.bookingId))
    expect(row).toMatchObject({ name: null, email: null, company: null, topic: null, cancelTokenHash: null })
    expect(row!.personalDataPurgedAt).not.toBeNull()
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, row!.calendarEventId!))
    expect(event).toMatchObject({ title: 'Apel (anonimizat)', description: null })
  })
})

describe('rute publice', () => {
  let app: Awaited<ReturnType<typeof buildServer>>
  beforeAll(async () => {
    app = await buildServer()
  })
  afterAll(async () => {
    await app.close()
  })

  it('fără token sau cu token greșit: 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/booking/slots' })).statusCode).toBe(401)
    const wrong = await app.inject({ method: 'GET', url: '/api/v1/public/booking/slots', headers: { 'x-booking-token': 'gresit' } })
    expect(wrong.statusCode).toBe(401)
  })

  it('body invalid: 422 cu cod stabil, fără detalii', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/booking',
      headers: { 'x-booking-token': 'test-booking-token' },
      payload: { start: 'nu', name: 'A', email: 'x', topic: '', consent: false },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ success: false, error: 'validation' })
  })

  it('respinge linkuri în nume, ca emailul de confirmare să nu poarte spam', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/booking',
      headers: { 'x-booking-token': 'test-booking-token' },
      payload: { start: MONDAY_10, name: 'Câștigă bani pe spam.com', email: 'victima@example.com', topic: 'orice subiect', consent: true },
    })
    expect(res.statusCode).toBe(422)
  })

  it('anularea nu are GET', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/booking/cancel?token=abc', headers: { 'x-booking-token': 'test-booking-token' } })
    expect(res.statusCode).toBe(404)
  })

  it('rutele de administrare cer autentificare', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/booking/settings' })).statusCode).toBe(401)
  })
})
