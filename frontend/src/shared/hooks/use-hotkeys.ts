import { useEffect, useRef, useSyncExternalStore } from 'react'

export interface Hotkey {
  /** `e`, `shift+?`, `mod+k`, `escape`. `mod` is Ctrl or Meta. */
  keys: string
  label: string
  onKey: (e: KeyboardEvent) => void
  allowInInputs?: boolean
}

export function matchesHotkey(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.toLowerCase().split('+')
  const key = parts.pop()
  const wants = (modifier: string) => parts.includes(modifier)
  const mod = e.ctrlKey || e.metaKey
  if (wants('mod') ? !mod : mod) return false
  if (wants('shift') !== e.shiftKey) return false
  if (wants('alt') !== e.altKey) return false
  return e.key.toLowerCase() === key
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

// What is mounted right now, so the help overlay lists exactly the shortcuts that work on this screen.
const registered = new Set<{ bindings: Hotkey[] }>()
const listeners = new Set<() => void>()
let snapshot: Hotkey[] = []

function publish() {
  snapshot = [...registered].flatMap((entry) => entry.bindings)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useActiveHotkeys(): Hotkey[] {
  return useSyncExternalStore(subscribe, () => snapshot)
}

export function useHotkeys(bindings: Hotkey[], options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const entry = useRef({ bindings })
  entry.current.bindings = bindings

  useEffect(() => {
    if (!enabled) return
    const current = entry.current
    registered.add(current)
    publish()
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTyping(e.target)
      const hit = current.bindings.find((binding) => (binding.allowInInputs || !typing) && matchesHotkey(e, binding.keys))
      hit?.onKey(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      registered.delete(current)
      publish()
    }
  }, [enabled])
}
