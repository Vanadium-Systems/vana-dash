import { describe, expect, it } from 'vitest'
import { normalizeForSearch, parseRoDecimal } from './utils'

describe('parseRoDecimal', () => {
  it.each([
    ['1.234,50', 1234.5],
    ['1234,5', 1234.5],
    ['1234.5', 1234.5],
    ['1.234.567', 1234567],
    ['-3', -3],
    [' 12 ', 12],
    ['0,015', 0.015],
  ])('%s → %d', (input, expected) => {
    expect(parseRoDecimal(input)).toBe(expected)
  })

  it.each(['', '   ', 'abc', '12a', '1,2,3'])('„%s" → NaN', (input) => {
    expect(parseRoDecimal(input)).toBeNaN()
  })
})

describe('normalizeForSearch', () => {
  it('ignoră diacriticele, inclusiv ş/ţ cu sedilă', () => {
    expect(normalizeForSearch('Setări Şcoală Ţară')).toBe('setari scoala tara')
  })
})
