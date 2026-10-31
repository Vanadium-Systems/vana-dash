// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useUrlState } from './use-url-state'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount(initialUrl: string) {
  const probe = { value: '', set: (_: string) => {}, url: '' }
  function Probe() {
    const [value, set] = useUrlState('q', 'all')
    const location = useLocation()
    Object.assign(probe, { value, set, url: location.pathname + location.search })
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(MemoryRouter, { initialEntries: [initialUrl] }, createElement(Probe))))
  return probe
}

describe('useUrlState', () => {
  it('reads the param, or the default when it is missing', () => {
    expect(mount('/x?q=abc').value).toBe('abc')
    expect(mount('/x').value).toBe('all')
  })

  it('writes the param and keeps the others', () => {
    const probe = mount('/x?page=2')
    act(() => probe.set('abc'))
    expect(probe.url).toBe('/x?page=2&q=abc')
  })

  it('removes the param when set back to the default', () => {
    const probe = mount('/x?q=abc&page=2')
    act(() => probe.set('all'))
    expect(probe.url).toBe('/x?page=2')
  })
})
