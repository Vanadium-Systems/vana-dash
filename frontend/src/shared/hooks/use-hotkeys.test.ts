// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { matchesHotkey, useActiveHotkeys, useHotkeys, type Hotkey } from './use-hotkeys'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const press = (init: KeyboardEventInit, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))

describe('matchesHotkey', () => {
  const event = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

  it('matches a plain key and rejects extra modifiers', () => {
    expect(matchesHotkey(event({ key: 'e' }), 'e')).toBe(true)
    expect(matchesHotkey(event({ key: 'e', ctrlKey: true }), 'e')).toBe(false)
    expect(matchesHotkey(event({ key: 'E', shiftKey: true }), 'e')).toBe(false)
  })

  it('treats mod as Ctrl or Meta', () => {
    expect(matchesHotkey(event({ key: 'k', ctrlKey: true }), 'mod+k')).toBe(true)
    expect(matchesHotkey(event({ key: 'K', metaKey: true }), 'mod+k')).toBe(true)
    expect(matchesHotkey(event({ key: 'k' }), 'mod+k')).toBe(false)
  })

  it('matches shift+? and named keys', () => {
    expect(matchesHotkey(event({ key: '?', shiftKey: true }), 'shift+?')).toBe(true)
    expect(matchesHotkey(event({ key: 'Escape' }), 'escape')).toBe(true)
  })
})

describe('useHotkeys', () => {
  it('fires, ignores inputs unless allowed, and unregisters on unmount', () => {
    const plain = vi.fn()
    const inInput = vi.fn()
    const seen: Hotkey[][] = []
    function Probe() {
      useHotkeys([
        { keys: 'e', label: 'Archive', onKey: plain },
        { keys: 'mod+k', label: 'Search', onKey: inInput, allowInInputs: true },
      ])
      seen.push(useActiveHotkeys())
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Probe)))
    expect(seen.at(-1)?.map((hotkey) => hotkey.label)).toEqual(['Archive', 'Search'])

    const input = document.body.appendChild(document.createElement('input'))
    act(() => { press({ key: 'e' }) })
    act(() => { press({ key: 'e' }, input) })
    act(() => { press({ key: 'k', ctrlKey: true }, input) })
    expect(plain).toHaveBeenCalledTimes(1)
    expect(inInput).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    act(() => { press({ key: 'e' }) })
    expect(plain).toHaveBeenCalledTimes(1)
  })
})
