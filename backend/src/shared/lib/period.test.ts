import { describe, expect, it } from 'vitest'
import { dayInZone, delta, forecastToMonthEnd, resolveComparePeriod } from './period.js'

describe('resolveComparePeriod', () => {
  it('compares month-to-date with the same days of last month', () => {
    const range = { from: new Date(2026, 10, 1), to: new Date(2026, 10, 15, 14, 0) }
    const previous = resolveComparePeriod(range, 'previous', 'mtd')
    expect(previous.from).toEqual(new Date(2026, 9, 1))
    expect(previous.to).toEqual(new Date(2026, 9, 15, 14, 0))
  })

  it('takes the whole of February on 31 March', () => {
    const range = { from: new Date(2027, 2, 1), to: new Date(2027, 2, 31, 10, 0) }
    const previous = resolveComparePeriod(range, 'previous', 'mtd')
    expect(previous.from).toEqual(new Date(2027, 1, 1))
    expect(previous.to).toEqual(new Date(new Date(2027, 2, 1).getTime() - 1))
  })

  it('stops at 29 February in a leap year', () => {
    const range = { from: new Date(2028, 2, 1), to: new Date(2028, 2, 30, 10, 0) }
    const previous = resolveComparePeriod(range, 'previous', 'mtd')
    expect(previous.to.getDate()).toBe(29)
    expect(previous.to.getMonth()).toBe(1)
  })

  it('keeps 29 March as 29 February in a leap year', () => {
    const range = { from: new Date(2028, 2, 1), to: new Date(2028, 2, 29, 10, 0) }
    expect(resolveComparePeriod(range, 'previous', 'mtd').to).toEqual(new Date(2028, 1, 29, 10, 0))
  })

  it('takes the same length right before for rolling periods', () => {
    const range = { from: new Date('2026-10-16T00:00:00Z'), to: new Date('2026-11-15T00:00:00Z') }
    const previous = resolveComparePeriod(range, 'previous', '30d')
    expect(previous).toEqual({ from: new Date('2026-09-16T00:00:00Z'), to: new Date('2026-10-16T00:00:00Z') })
  })

  it('starts a period of the same length at a given date', () => {
    const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-08T00:00:00Z') }
    expect(resolveComparePeriod(range, '2025-11-01')).toEqual({
      from: new Date('2025-11-01T00:00:00Z'),
      to: new Date('2025-11-08T00:00:00Z'),
    })
  })
})

describe('delta', () => {
  it('gives the change in value and percent', () => {
    expect(delta(1240, 1000)).toEqual({ abs: '240.00', pct: 24 })
    expect(delta(500, 1000)).toEqual({ abs: '-500.00', pct: -50 })
  })

  it('has no percent when the previous period is zero', () => {
    expect(delta(300, 0)).toEqual({ abs: '300.00', pct: null })
  })
})

describe('dayInZone', () => {
  it('uses the company zone, not UTC', () => {
    // 23:30 UTC on 14 November is already 15 November in Bucharest.
    expect(dayInZone(new Date('2026-11-14T23:30:00Z'), 'Europe/Bucharest')).toBe('2026-11-15')
    expect(dayInZone(new Date('2026-11-14T23:30:00Z'), 'UTC')).toBe('2026-11-14')
  })

  it('follows the switch to winter time', () => {
    // 25 October 2026, 22:30 UTC = 00:30 on the 26th in Bucharest (UTC+2 after the switch).
    expect(dayInZone(new Date('2026-10-25T22:30:00Z'), 'Europe/Bucharest')).toBe('2026-10-26')
  })
})

describe('forecastToMonthEnd', () => {
  it('spreads the average of finished working days over the working days left', () => {
    // November 2026: the 2nd is a Monday. Two finished working days (2nd, 3rd), today the 4th.
    const values = new Map([
      ['2026-11-02', 100],
      ['2026-11-03', 300],
      ['2026-11-01', 999], // a Sunday: not a working day, not counted
    ])
    const forecast = forecastToMonthEnd(values, '2026-11-04')
    expect(forecast[0]).toEqual({ date: '2026-11-04', value: 200 })
    expect(forecast.find((p) => p.date === '2026-11-07')?.value).toBe(0) // Saturday
    expect(forecast.at(-1)?.date).toBe('2026-11-30')
  })

  it('is empty before the first working day of the month has finished', () => {
    expect(forecastToMonthEnd(new Map(), '2026-11-02')).toEqual([])
  })
})
