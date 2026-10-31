import { describe, expect, it } from 'vitest'
import { currentPageRefresh, registerPageRefresh } from './use-pull-to-refresh'

describe('page refresh registry', () => {
  it('has no handler until a page registers one', () => {
    expect(currentPageRefresh()).toBeUndefined()
  })

  it('answers with the last registered handler and falls back when it leaves', () => {
    const first = () => {}
    const second = () => {}
    const offFirst = registerPageRefresh(first)
    const offSecond = registerPageRefresh(second)
    expect(currentPageRefresh()).toBe(second)
    offSecond()
    expect(currentPageRefresh()).toBe(first)
    offFirst()
    expect(currentPageRefresh()).toBeUndefined()
  })

  it('removes a handler that leaves before the later one', () => {
    const first = () => {}
    const second = () => {}
    const offFirst = registerPageRefresh(first)
    const offSecond = registerPageRefresh(second)
    offFirst()
    expect(currentPageRefresh()).toBe(second)
    offSecond()
  })
})
