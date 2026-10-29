/**
 * Recurența task-urilor programate (PLAN.md Contract B) — funcții pure, fără DB.
 * Ora rămâne pe ceasul Europe/Bucharest peste zile, luni cu lungimi diferite și DST.
 */
import { describe, expect, it } from 'vitest'
import { zonedTimeToUtc, isStaleRun, nextRecurrenceRun } from './schedule-recurrence.js'

const TZ = 'Europe/Bucharest'

// 2026-08-26 18:00 local Bucharest (EEST, UTC+3 vara) = 15:00 UTC
const WED_1800 = zonedTimeToUtc(2026, 8, 26, 18, 0, TZ)

function wallClockOf(date: Date): { day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: weekdays.indexOf(get('weekday')),
  }
}

describe('zonedTimeToUtc', () => {
  it('respectă fusul de vară (EEST, UTC+3) în august', () => {
    expect(zonedTimeToUtc(2026, 8, 26, 18, 0, TZ).toISOString()).toBe('2026-08-26T15:00:00.000Z')
  })

  it('respectă fusul de iarnă (EET, UTC+2) în decembrie', () => {
    expect(zonedTimeToUtc(2026, 12, 26, 18, 0, TZ).toISOString()).toBe('2026-12-26T16:00:00.000Z')
  })

  it('trece corect peste schimbarea DST (ultima duminică din octombrie 2026: 25 oct)', () => {
    // 26 octombrie 2026, aceeași oră 18:00 local → după trecerea pe EET = 16:00 UTC
    expect(zonedTimeToUtc(2026, 10, 26, 18, 0, TZ).toISOString()).toBe('2026-10-26T16:00:00.000Z')
  })
})

describe('nextRecurrenceRun', () => {
  it('daily = mâine la aceeași oră locală', () => {
    const next = nextRecurrenceRun(WED_1800, 'daily', null, TZ)
    const w = wallClockOf(next)
    expect(w.day).toBe(27)
    expect(w.hour).toBe(18)
    expect(w.minute).toBe(0)
  })

  it('daily păstrează ora locală peste schimbarea DST (octombrie)', () => {
    // 24 oct (EEST) → 25 oct e ziua schimbării; 18:00 local rămâne 18:00 pe ambele zile
    const fri = zonedTimeToUtc(2026, 10, 24, 18, 0, TZ)
    const next = nextRecurrenceRun(fri, 'daily', null, TZ)
    const w = wallClockOf(next)
    expect(w.day).toBe(25)
    expect(w.hour).toBe(18)
  })

  it('weekly sare la următoarea apariție a zilei cerute (miercuri → vineri)', () => {
    const next = nextRecurrenceRun(WED_1800, 'weekly', 5, TZ)
    const w = wallClockOf(next)
    expect(w.weekday).toBe(5)
    expect(w.hour).toBe(18)
  })

  it('weekly pe aceeași zi a săptămânii avansează cu exact 7 zile', () => {
    const next = nextRecurrenceRun(WED_1800, 'weekly', null, TZ)
    expect(wallClockOf(next).day).toBe(2) // 26 aug + 7 = 2 sep
    expect(wallClockOf(next).hour).toBe(18)
  })
})

describe('isStaleRun', () => {
  const now = new Date('2026-08-26T12:00:00.000Z')

  it('pending recent nu e stale', () => {
    expect(isStaleRun(new Date(now.getTime() - 3 * 24 * 3600 * 1000), now)).toBe(false)
  })

  it('pending mai vechi de 7 zile e stale (nu se livrează întârziat)', () => {
    expect(isStaleRun(new Date(now.getTime() - 8 * 24 * 3600 * 1000), now)).toBe(true)
    // exact la limită nu e încă stale — prag-ul e strict „peste 7 zile"
    expect(isStaleRun(new Date(now.getTime() - 7 * 24 * 3600 * 1000 - 1), now)).toBe(true)
    expect(isStaleRun(new Date(now.getTime() - 7 * 24 * 3600 * 1000 + 1), now)).toBe(false)
  })
})
