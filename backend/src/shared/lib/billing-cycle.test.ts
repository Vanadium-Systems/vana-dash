import { describe, expect, it } from 'vitest'
import { computeNextOccurrence, dayAfter } from './billing-cycle.js'

describe('computeNextOccurrence', () => {
  it('monthly: returns the same month if the day has not passed yet', () => {
    const result = computeNextOccurrence({ cycle: 'monthly', day: 20 }, new Date('2026-03-05T00:00:00Z'))
    expect(result).toBe('2026-03-20')
  })

  it('monthly: rolls to next month if the day already passed', () => {
    const result = computeNextOccurrence({ cycle: 'monthly', day: 5 }, new Date('2026-03-20T00:00:00Z'))
    expect(result).toBe('2026-04-05')
  })

  it('monthly: exact match on fromDate counts as "not passed" (inclusive)', () => {
    const result = computeNextOccurrence({ cycle: 'monthly', day: 20 }, new Date('2026-03-20T00:00:00Z'))
    expect(result).toBe('2026-03-20')
  })

  it('monthly: day 28 works correctly across February (no clamping edge case, by design)', () => {
    const result = computeNextOccurrence({ cycle: 'monthly', day: 28 }, new Date('2027-02-01T00:00:00Z'))
    expect(result).toBe('2027-02-28')
  })

  it('annual: same year if month/day not passed yet', () => {
    const result = computeNextOccurrence({ cycle: 'annual', day: 15, month: 6 }, new Date('2026-01-01T00:00:00Z'))
    expect(result).toBe('2026-06-15')
  })

  it('annual: rolls to next year if month/day already passed', () => {
    const result = computeNextOccurrence({ cycle: 'annual', day: 15, month: 6 }, new Date('2026-07-01T00:00:00Z'))
    expect(result).toBe('2027-06-15')
  })

  it('annual: defaults to month 1 if month is missing/null', () => {
    const result = computeNextOccurrence({ cycle: 'annual', day: 10, month: null }, new Date('2026-01-01T00:00:00Z'))
    expect(result).toBe('2026-01-10')
  })
})

describe('dayAfter', () => {
  it('returns the calendar day following the given ISO date', () => {
    expect(dayAfter('2026-03-20').toISOString().slice(0, 10)).toBe('2026-03-21')
  })

  it('rolls over month boundaries correctly', () => {
    expect(dayAfter('2026-02-28').toISOString().slice(0, 10)).toBe('2026-03-01')
  })

  it('rolls over year boundaries correctly', () => {
    expect(dayAfter('2026-12-31').toISOString().slice(0, 10)).toBe('2027-01-01')
  })
})
