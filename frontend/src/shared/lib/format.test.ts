import { describe, expect, it } from 'vitest'
import { formatMoney, formatMoneyParts } from './format'

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
