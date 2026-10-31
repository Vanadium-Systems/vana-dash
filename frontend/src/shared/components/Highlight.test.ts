import { describe, expect, it } from 'vitest'
import { highlightRanges } from './Highlight'

describe('highlightRanges', () => {
  it('ignores case and the cedilla form of ș/ț', () => {
    expect(highlightRanges('Ştefan Popescu', 'stef')).toEqual([[0, 4]])
    expect(highlightRanges('Ștefan', 'ŞTE')).toEqual([[0, 3]])
  })

  it('matches țară with tara and keeps original positions', () => {
    expect(highlightRanges('Din țară', 'tara')).toEqual([[4, 8]])
    expect(highlightRanges('Țara', 'ţ')).toEqual([[0, 1]])
  })

  it('treats ă, â and î as a and i', () => {
    expect(highlightRanges('România și gândul', 'romania')).toEqual([[0, 7]])
    expect(highlightRanges('gândul', 'gan')).toEqual([[0, 3]])
  })

  it('highlights each word and merges overlaps', () => {
    expect(highlightRanges('factura noua factura', 'noua fact')).toEqual([[0, 4], [8, 12], [13, 17]])
    expect(highlightRanges('abcd', 'ab bc')).toEqual([[0, 3]])
  })

  it('returns nothing for an empty query or no match', () => {
    expect(highlightRanges('Ștefan', '')).toEqual([])
    expect(highlightRanges('Ștefan', '   ')).toEqual([])
    expect(highlightRanges('Ștefan', 'xyz')).toEqual([])
  })
})
