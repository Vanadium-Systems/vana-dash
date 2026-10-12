import { describe, expect, it } from 'vitest'
import { normalizeTime } from './time-input'

describe('normalizeTime', () => {
  it.each([
    ['9', '09:00'],
    ['930', '09:30'],
    ['0930', '09:30'],
    ['9:30', '09:30'],
    ['9.30', '09:30'],
    ['23:59', '23:59'],
    ['00:00', '00:00'],
    ['18:3', '18:30'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeTime(raw)).toBe(expected)
  })

  it.each(['24:00', '12:60', '', 'ab', '12345', '1:2:3'])('respinge %s', (raw) => {
    expect(normalizeTime(raw)).toBeNull()
  })
})
