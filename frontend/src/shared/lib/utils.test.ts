import { describe, expect, it } from 'vitest'
import { cn, cva, normalizeForSearch, parseRoDecimal } from './utils'

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

describe('cn and cva', () => {
  it('combines strings, objects, arrays, and merges conflicting Tailwind classes', () => {
    expect(cn('px-2 py-1', ['text-sm', { hidden: false, block: true }], 'px-4')).toBe('py-1 text-sm block px-4')
  })

  it('resolves default, explicit, and compound variants in cva', () => {
    const btn = cva('inline-flex', {
      variants: {
        variant: { default: 'bg-primary', ghost: 'bg-transparent' },
        size: { sm: 'h-8', md: 'h-9' },
      },
      defaultVariants: { variant: 'default', size: 'md' },
      compoundVariants: [{ variant: 'ghost', size: 'sm', className: 'px-2' }],
    })
    expect(btn()).toBe('inline-flex bg-primary h-9')
    expect(btn({ variant: 'ghost', size: 'sm', className: 'extra' })).toBe('inline-flex bg-transparent h-8 px-2 extra')
  })
})
