import { describe, expect, it } from 'vitest'
import { formatCount, normalizeForSearch, parseRoDecimal } from './utils'

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

describe('formatCount', () => {
  it.each([
    [1, '1 fișier'],
    [3, '3 fișiere'],
    [19, '19 fișiere'],
    [20, '20 de fișiere'],
    [101, '101 fișiere'],
    [120, '120 de fișiere'],
    [1000, '1.000 de fișiere'],
  ])('%d', (n, expected) => {
    expect(formatCount(n, 'fișier', 'fișiere')).toBe(expected)
  })
})

describe('normalizeForSearch', () => {
  it('ignoră diacriticele, inclusiv ş/ţ cu sedilă', () => {
    expect(normalizeForSearch('Setări Şcoală Ţară')).toBe('setari scoala tara')
  })
})
