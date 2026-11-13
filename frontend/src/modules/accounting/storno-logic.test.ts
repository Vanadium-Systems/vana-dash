import { describe, expect, it } from 'vitest'
import { checkStornoQuantity, fullStornoCents, isFullyStornoed, partialStornoCents } from './storno-logic'

const lines = [
  { id: 'a', quantity: 2, unitPrice: 250, vatRate: 19 },
  { id: 'b', quantity: 1, unitPrice: 100, vatRate: 9 },
]

describe('checkStornoQuantity', () => {
  it('treats an empty box as a line left out', () => {
    expect(checkStornoQuantity('  ', 2)).toEqual({ state: 'empty' })
  })
  it('accepts a Romanian decimal up to the invoiced quantity', () => {
    expect(checkStornoQuantity('1,5', 2)).toEqual({ state: 'ok', value: 1.5 })
    expect(checkStornoQuantity('2', 2)).toEqual({ state: 'ok', value: 2 })
  })
  it('rejects zero, negatives and text', () => {
    expect(checkStornoQuantity('0', 2).state).toBe('invalid')
    expect(checkStornoQuantity('-1', 2).state).toBe('invalid')
    expect(checkStornoQuantity('abc', 2).state).toBe('invalid')
  })
  it('rejects more than was invoiced and reports the maximum', () => {
    expect(checkStornoQuantity('2,01', 2)).toEqual({ state: 'exceeds', max: 2 })
  })
})

describe('partialStornoCents', () => {
  it('sums net plus VAT of the picked lines only', () => {
    // 1 × 250 + 19% = 297,50; line b is not picked.
    expect(partialStornoCents(lines, { a: 1 })).toBe(29750)
    // plus 1 × 100 + 9% = 109,00
    expect(partialStornoCents(lines, { a: 1, b: 1 })).toBe(29750 + 10900)
  })
  it('is zero with nothing picked', () => {
    expect(partialStornoCents(lines, {})).toBe(0)
  })
  it('rounds each line to a cent', () => {
    expect(partialStornoCents([{ id: 'x', quantity: 3, unitPrice: 0.333, vatRate: 19 }], { x: 3 })).toBe(119)
  })
})

describe('full storno', () => {
  it('is the invoice minus earlier credit notes, whatever their sign', () => {
    expect(fullStornoCents(1190, [])).toBe(119000)
    expect(fullStornoCents(1190, [{ amount: -297.5 }])).toBe(119000 - 29750)
    expect(fullStornoCents(1190, [{ amount: 297.5 }])).toBe(119000 - 29750)
  })
  it('never goes below zero', () => {
    expect(fullStornoCents(100, [{ amount: -150 }])).toBe(0)
  })
  it('reads fully stornoed only when the credit notes cover the invoice', () => {
    expect(isFullyStornoed(1190, [])).toBe(false)
    expect(isFullyStornoed(1190, [{ amount: -297.5 }])).toBe(false)
    expect(isFullyStornoed(1190, [{ amount: -1190 }])).toBe(true)
    expect(isFullyStornoed(1190, [{ amount: -700 }, { amount: -490 }])).toBe(true)
  })
})
