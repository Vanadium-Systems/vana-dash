// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberRoll } from './NumberRoll'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const format = (n: number) => `${Math.round(n)} lei`

function mount(value: number) {
  const container = document.createElement('div')
  const root = createRoot(container)
  const render = (next: number) => act(() => root.render(createElement(NumberRoll, { value: next, format })))
  render(value)
  return { container, render }
}

describe('NumberRoll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rolls up on mount, then shows later changes instantly', () => {
    const { container, render } = mount(1000)
    expect(container.textContent).toBe('0 lei')
    act(() => { vi.advanceTimersByTime(700) })
    expect(container.textContent).toBe('1000 lei')
    render(2500)
    expect(container.textContent).toBe('2500 lei')
  })

  it('skips the roll with reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { container, render } = mount(1000)
    expect(container.textContent).toBe('1000 lei')
    render(40)
    expect(container.textContent).toBe('40 lei')
  })
})
