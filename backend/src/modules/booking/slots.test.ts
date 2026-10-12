import { describe, expect, it } from 'vitest'
import { allDayToInterval, computeSlots, type Interval } from './slots.js'
import type { BookingSettings } from './schema.js'

const base: BookingSettings = {
  enabled: true,
  durationMin: 30,
  bufferMin: 0,
  minNoticeHours: 0,
  horizonDays: 14,
  weekly: [{ weekday: 1, start: '10:00', end: '12:00' }],
}

// Duminică 18.10.2026, 20:00 în București (UTC+3) — luni 19.10 e încă pe ora de vară.
const SUNDAY_EVENING = new Date('2026-10-18T17:00:00.000Z')
const iso = (slots: Array<{ start: Date }>) => slots.map((s) => s.start.toISOString())

describe('computeSlots', () => {
  it('întoarce nimic când programările sunt oprite', () => {
    expect(computeSlots({ ...base, enabled: false }, SUNDAY_EVENING, [], 14)).toEqual([])
  })

  it('împarte fereastra de luni în sloturi de 30 min, pe ora din București', () => {
    const slots = computeSlots(base, SUNDAY_EVENING, [], 1)
    expect(iso(slots)).toEqual([
      '2026-10-19T07:00:00.000Z',
      '2026-10-19T07:30:00.000Z',
      '2026-10-19T08:00:00.000Z',
      '2026-10-19T08:30:00.000Z',
    ])
  })

  it('10:00 rămâne 10:00 local după trecerea la ora de iarnă (25.10.2026)', () => {
    const slots = computeSlots(base, SUNDAY_EVENING, [], 8)
    const mondayAfterDst = iso(slots).filter((s) => s.startsWith('2026-10-26'))
    expect(mondayAfterDst[0]).toBe('2026-10-26T08:00:00.000Z')
    expect(mondayAfterDst).toHaveLength(4)
  })

  it('respectă preavizul minim', () => {
    // Luni 19.10, 09:00 local; cu 2 ore preaviz, primul slot e 11:00.
    const now = new Date('2026-10-19T06:00:00.000Z')
    const slots = computeSlots({ ...base, minNoticeHours: 2 }, now, [], 1)
    expect(iso(slots)).toEqual(['2026-10-19T08:00:00.000Z', '2026-10-19T08:30:00.000Z'])
  })

  it('nu trece de orizontul de zile', () => {
    const slots = computeSlots({ ...base, horizonDays: 7 }, SUNDAY_EVENING, [], 30)
    expect(slots.every((s) => s.start.getTime() < SUNDAY_EVENING.getTime() + 7 * 86_400_000)).toBe(true)
    expect(iso(slots).some((s) => s.startsWith('2026-10-26'))).toBe(false)
  })

  it('bufferul blochează și sloturile vecine unui interval ocupat', () => {
    // Ocupat 10:30–11:00 local, buffer 10 min: 10:00 se termină la 10:30 (sub buffer), 11:00 începe sub buffer.
    const busy: Interval[] = [{ start: new Date('2026-10-19T07:30:00.000Z'), end: new Date('2026-10-19T08:00:00.000Z') }]
    const slots = computeSlots({ ...base, bufferMin: 10 }, SUNDAY_EVENING, busy, 1)
    expect(iso(slots)).toEqual(['2026-10-19T08:30:00.000Z'])
  })

  it('un bloc care acoperă doar o parte dintr-un slot îl scoate pe tot', () => {
    const busy: Interval[] = [{ start: new Date('2026-10-19T07:15:00.000Z'), end: new Date('2026-10-19T07:20:00.000Z') }]
    const slots = computeSlots(base, SUNDAY_EVENING, busy, 1)
    expect(iso(slots)).toEqual(['2026-10-19T07:30:00.000Z', '2026-10-19T08:00:00.000Z', '2026-10-19T08:30:00.000Z'])
  })

  it('un eveniment de o zi întreagă ocupă toată ziua locală', () => {
    const allDay = allDayToInterval(new Date('2026-10-18T21:00:00.000Z'), new Date('2026-10-18T21:00:00.000Z'))
    expect(allDay.start.toISOString()).toBe('2026-10-18T21:00:00.000Z')
    expect(allDay.end.toISOString()).toBe('2026-10-19T21:00:00.000Z')
    expect(computeSlots(base, SUNDAY_EVENING, [allDay], 1)).toEqual([])
  })

  it('ziua schimbării orei (25.10.2026) ocupă 25 de ore', () => {
    const allDay = allDayToInterval(new Date('2026-10-24T21:00:00.000Z'), new Date('2026-10-24T21:00:00.000Z'))
    expect(allDay.end.getTime() - allDay.start.getTime()).toBe(25 * 3_600_000)
  })
})
