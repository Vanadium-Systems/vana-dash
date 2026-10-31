// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { selectRange, useSelection } from './use-selection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const none = { ctrlKey: false, metaKey: false, shiftKey: false }

describe('selectRange', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('runs from anchor to target in either direction', () => {
    expect(selectRange(ids, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(selectRange(ids, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('falls back to the target alone without a usable anchor', () => {
    expect(selectRange(ids, null, 'c')).toEqual(['c'])
    expect(selectRange(ids, 'zz', 'c')).toEqual(['c'])
  })
})

describe('useSelection', () => {
  let unmount = () => {}
  afterEach(() => unmount())

  function mount(initial: string[]) {
    const api = { current: null as unknown as ReturnType<typeof useSelection<string>> }
    function Probe({ ids }: { ids: string[] }) {
      api.current = useSelection(ids)
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(createElement(Probe, { ids: initial })))
    unmount = () => act(() => root.unmount())
    return { api, rerender: (ids: string[]) => act(() => root.render(createElement(Probe, { ids }))) }
  }

  it('plain click is left to the caller until something is selected', () => {
    const { api } = mount(['a', 'b', 'c'])
    let handled = true
    act(() => { handled = api.current.onRowClick(none, 'a') })
    expect(handled).toBe(false)
    act(() => { api.current.onRowClick({ ...none, ctrlKey: true }, 'a') })
    act(() => { handled = api.current.onRowClick(none, 'b') })
    expect(handled).toBe(true)
    expect([...api.current.selected]).toEqual(['a', 'b'])
  })

  it('shift-click adds the range from the last clicked row', () => {
    const { api } = mount(['a', 'b', 'c', 'd'])
    act(() => { api.current.onRowClick({ ...none, metaKey: true }, 'b') })
    act(() => { api.current.onRowClick({ ...none, shiftKey: true }, 'd') })
    expect([...api.current.selected].sort()).toEqual(['b', 'c', 'd'])
    expect(api.current.someSelected).toBe(true)
  })

  it('drops ids that left the list and clears on Escape', () => {
    const { api, rerender } = mount(['a', 'b', 'c'])
    act(() => api.current.selectAll())
    expect(api.current.allSelected).toBe(true)
    rerender(['a', 'c'])
    expect([...api.current.selected].sort()).toEqual(['a', 'c'])
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(api.current.count).toBe(0)
  })
})
