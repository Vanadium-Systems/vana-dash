// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSelection } from '@/shared/hooks/use-selection'
import { useRowActivation } from './row-activation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const none = { ctrlKey: false, metaKey: false, shiftKey: false }
const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))

describe('useRowActivation', () => {
  let unmount = () => {}
  afterEach(() => {
    unmount()
    vi.useRealTimers()
  })

  function mount() {
    const open = vi.fn()
    const probe = { selection: null as unknown as ReturnType<typeof useSelection<string>>, activation: null as unknown as ReturnType<typeof useRowActivation<{ id: string }>> }
    function Probe() {
      probe.selection = useSelection(rows.map((row) => row.id))
      probe.activation = useRowActivation(probe.selection, open)
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Probe)))
    unmount = () => act(() => root.unmount())
    return { probe, open }
  }

  it('opens on a plain click when nothing is selected', () => {
    const { probe, open } = mount()
    act(() => probe.activation.onActivate(none, rows[1]!))
    expect(open).toHaveBeenCalledWith(rows[1])
    expect(probe.selection.count).toBe(0)
  })

  it('selects the range from the last row clicked on Shift+click, without opening', () => {
    const { probe, open } = mount()
    act(() => probe.activation.onActivate({ ...none, ctrlKey: true }, rows[1]!))
    act(() => probe.activation.onActivate({ ...none, shiftKey: true }, rows[3]!))
    expect([...probe.selection.selected].sort()).toEqual(['b', 'c', 'd'])
    expect(open).not.toHaveBeenCalled()
  })

  it('selects upwards too, and adds to what was selected', () => {
    const { probe } = mount()
    act(() => probe.activation.onActivate({ ...none, ctrlKey: true }, rows[4]!))
    act(() => probe.activation.onActivate({ ...none, shiftKey: true }, rows[2]!))
    expect([...probe.selection.selected].sort()).toEqual(['c', 'd', 'e'])
  })

  it('selects instead of opening once a selection exists', () => {
    const { probe, open } = mount()
    act(() => probe.activation.onActivate({ ...none, metaKey: true }, rows[0]!))
    act(() => probe.activation.onActivate(none, rows[2]!))
    expect([...probe.selection.selected].sort()).toEqual(['a', 'c'])
    expect(open).not.toHaveBeenCalled()
  })

  it('a long press starts the selection and the tap that ends it does not open the row', () => {
    vi.useFakeTimers()
    const { probe, open } = mount()
    act(() => probe.activation.startLongPress('c'))
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(probe.selection.isSelected('c')).toBe(true)
    // The finger lifts: the browser sends a click on the same row. With one row selected the
    // click would toggle it off again, so the long press has to swallow it.
    act(() => probe.activation.onActivate(none, rows[2]!))
    expect(probe.selection.isSelected('c')).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it('a short touch does not select', () => {
    vi.useFakeTimers()
    const { probe } = mount()
    act(() => probe.activation.startLongPress('c'))
    act(() => probe.activation.cancelLongPress())
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(probe.selection.count).toBe(0)
  })
})
