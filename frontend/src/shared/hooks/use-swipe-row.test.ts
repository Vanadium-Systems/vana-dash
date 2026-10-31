import { describe, expect, it } from 'vitest'
import { swipeOutcome } from './use-swipe-row'

describe('swipeOutcome', () => {
  it('fires past the threshold in the dominant horizontal direction', () => {
    expect(swipeOutcome(-100, 10, 80)).toBe('left')
    expect(swipeOutcome(100, -10, 80)).toBe('right')
  })

  it('springs back below the threshold', () => {
    expect(swipeOutcome(-79, 0, 80)).toBeNull()
  })

  it('ignores a drag that is mostly vertical', () => {
    expect(swipeOutcome(-100, 120, 80)).toBeNull()
  })
})
