import { describe, expect, it } from 'vitest'
import { formatSessionTime, pricesLate } from './session'

describe('formatSessionTime', () => {
  const friday = new Date('2026-09-25T15:00:00Z')

  it('azi: doar ora României', () => {
    expect(formatSessionTime('2026-09-25T20:00:00Z', friday)).toBe('23:00')
  })

  it('altă zi: cu ziua săptămânii', () => {
    expect(formatSessionTime('2026-09-28T13:30:00Z', friday)).toBe('luni, 28 sept., 16:30')
  })
})

describe('pricesLate', () => {
  it('întârzierea contează doar cu bursa deschisă', () => {
    expect(pricesLate(true, 20 * 60)).toBe(true)
    expect(pricesLate(true, 60)).toBe(false)
    expect(pricesLate(false, 60 * 3600)).toBe(false)
  })
})
