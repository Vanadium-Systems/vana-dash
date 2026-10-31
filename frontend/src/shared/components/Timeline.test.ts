import { describe, expect, it } from 'vitest'
import { groupByDay, type TimelineEntry } from './Timeline'

const entry = (id: string, at: string): TimelineEntry => ({ id, author: 'Ana', at, text: id })

describe('groupByDay', () => {
  it('groups consecutive entries of the same day and splits on a new day', () => {
    const groups = groupByDay([
      entry('a', '2026-10-30T12:00:00Z'),
      entry('b', '2026-10-30T09:00:00Z'),
      entry('c', '2026-10-28T12:00:00Z'),
    ])
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([['a', 'b'], ['c']])
  })

  it('returns nothing for no entries', () => {
    expect(groupByDay([])).toEqual([])
  })
})
