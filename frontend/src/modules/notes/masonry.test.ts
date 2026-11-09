import { describe, expect, it } from 'vitest'
import { CARD_WIDTH, GAP, layoutMasonry, masonryGeometry } from './masonry'

describe('layoutMasonry', () => {
  it('puts each card into the shortest column, reading left to right', () => {
    // Heights 100, 50, 80, 40, 60 in 3 columns (gap 0 to keep the sums readable).
    const { slots } = layoutMasonry([100, 50, 80, 40, 60], 3, 0)
    expect(slots.map((slot) => slot.column)).toEqual([0, 1, 2, 1, 2])
    expect(slots.map((slot) => slot.top)).toEqual([0, 0, 0, 50, 80])
  })

  it('breaks a tie towards the leftmost column', () => {
    const { slots } = layoutMasonry([10, 10, 10, 10], 2, 0)
    expect(slots.map((slot) => slot.column)).toEqual([0, 1, 0, 1])
  })

  it('stacks everything in one column and reports the height without the trailing gap', () => {
    const { slots, height } = layoutMasonry([30, 30], 1, 10)
    expect(slots.map((slot) => slot.top)).toEqual([0, 40])
    expect(height).toBe(70)
  })

  it('is empty for no cards', () => {
    expect(layoutMasonry([], 3)).toEqual({ slots: [], height: 0 })
  })
})

describe('masonryGeometry', () => {
  it('uses fixed 240px columns, as many as fit, aligned left', () => {
    const geometry = masonryGeometry(1000)
    expect(geometry.cardWidth).toBe(CARD_WIDTH)
    expect(geometry.columns).toBe(Math.floor((1000 + GAP) / (CARD_WIDTH + GAP)))
    expect(geometry.offsetX).toBe(0)
  })

  it('uses exactly two fluid columns on a phone', () => {
    const geometry = masonryGeometry(360)
    expect(geometry.columns).toBe(2)
    expect(geometry.cardWidth).toBe((360 - GAP) / 2)
    expect(geometry.offsetX).toBe(0)
  })
})
