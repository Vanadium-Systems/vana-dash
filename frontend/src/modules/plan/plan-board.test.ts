import { describe, expect, it } from 'vitest'
import { moveAcrossTiers, settleDrop, tierDropId } from './plan-board'

const items = { 1: ['a', 'b'], 2: ['c'], 3: [], 4: [] }

describe('moveAcrossTiers', () => {
  it('takes the place of the goal it is dragged over', () => {
    expect(moveAcrossTiers(items, 'a', 'c')).toEqual({ ...items, 1: ['b'], 2: ['a', 'c'] })
  })

  it('goes to the end of an empty tier when dropped on the tier itself', () => {
    expect(moveAcrossTiers(items, 'b', tierDropId(3))).toEqual({ ...items, 1: ['a'], 3: ['b'] })
  })

  it('leaves the lists alone inside the same tier', () => {
    expect(moveAcrossTiers(items, 'a', 'b')).toBe(items)
  })
})

describe('settleDrop', () => {
  it('reorders inside a tier and gives a 1-based position', () => {
    expect(settleDrop(items, 'a', 'b')).toEqual({ items: { ...items, 1: ['b', 'a'] }, tier: 1, position: 2 })
  })

  it('reports the tier a goal was moved to', () => {
    const moved = moveAcrossTiers(items, 'a', 'c')
    expect(settleDrop(moved, 'a', 'a')).toMatchObject({ tier: 2, position: 1 })
  })

  it('is null for a goal in no list', () => {
    expect(settleDrop(items, 'zzz', 'a')).toBeNull()
  })
})
