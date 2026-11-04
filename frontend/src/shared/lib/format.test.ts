import { describe, expect, it } from 'vitest'
import { formatListDate, formatMoney, formatMoneyParts } from './format'

describe('formatMoneyParts', () => {
  it('splits the decimals off and keeps the currency as a suffix', () => {
    expect(formatMoneyParts(1234.5, 'lei')).toEqual({ whole: '1.234', fraction: ',50', suffix: ' lei' })
  })

  it('joins back to exactly what formatMoney returns', () => {
    for (const amount of [0, 7, -1234.56, 1234567.891]) {
      const { whole, fraction, suffix } = formatMoneyParts(amount, 'EUR')
      expect(whole + fraction + suffix).toBe(formatMoney(amount, 'EUR'))
    }
  })

  it('has no fraction when decimals is 0', () => {
    expect(formatMoneyParts(1234.5, 'lei', { decimals: 0 }).fraction).toBe('')
  })

  it('keeps the minus sign in whole', () => {
    expect(formatMoneyParts(-5, 'lei').whole).toBe('-5')
  })
})

describe('formatListDate', () => {
  // 2026-11-04 12:00 in Bucharest (UTC+2 in November)
  const now = new Date('2026-11-04T10:00:00Z')

  it('shows only the time for the same day, in the company time zone', () => {
    expect(formatListDate('2026-11-04T07:30:00Z', now)).toMatch(/^0?9[:.]30$/)
  })

  it('uses the company day, not the UTC day, to decide "same day"', () => {
    // 22:30 UTC on Nov 3 is already Nov 4 00:30 in Bucharest.
    expect(formatListDate('2026-11-03T22:30:00Z', now)).toMatch(/^0?0[:.]30$/)
  })

  it('shows day and short month for another day of the same year', () => {
    const out = formatListDate('2026-03-15T10:00:00Z', now)
    expect(out).toMatch(/^15 \p{L}+\.?$/u)
    expect(out).not.toMatch(/2026/)
  })

  it('shows the full numeric date for another year', () => {
    expect(formatListDate('2025-12-31T10:00:00Z', now)).toMatch(/^31[./]12[./]2025$/)
  })
})
