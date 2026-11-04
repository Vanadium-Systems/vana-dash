import { useSyncExternalStore } from 'react'
import type { EmailDraft } from '@/shared/lib/types'

// The open compose windows, outside React state so any screen can open one (the list, a thread,
// the undo toast, another page through /email?compose). At most two are expanded at once: a third
// minimizes the oldest, like Gmail.

export type ComposeInit =
  | { kind: 'new'; to?: string[] }
  | { kind: 'draft'; draft: EmailDraft }
  | { kind: 'reply'; threadId: string; replyAll: boolean; lastSeenMessageId: string | null; fromAddress: string; to: string[]; cc: string[] }
  | { kind: 'forward'; messageId: string; threadId: string; subject: string; fromAddress: string }

export interface ComposeWindow {
  id: string
  init: ComposeInit
  minimized: boolean
  /** The window's title bar text, kept current by the form (subject or "New message"). */
  title: string
}

const MAX_EXPANDED = 2
const MAX_WINDOWS = 4

let windows: ComposeWindow[] = []
const listeners = new Set<() => void>()
let nextId = 1

function publish(next: ComposeWindow[]) {
  windows = next
  for (const listener of listeners) listener()
}

/** Same draft or same thread reply already open → focus it instead of opening a second copy. */
function sameTarget(a: ComposeInit, b: ComposeInit): boolean {
  if (a.kind === 'draft' && b.kind === 'draft') return a.draft.id === b.draft.id
  if (a.kind === 'reply' && b.kind === 'reply') return a.threadId === b.threadId
  return false
}

export function openCompose(init: ComposeInit): void {
  const existing = windows.find((w) => sameTarget(w.init, init))
  if (existing) {
    publish(windows.map((w) => (w.id === existing.id ? { ...w, minimized: false } : w)))
    return
  }
  let next = [...windows, { id: `c${nextId++}`, init, minimized: false, title: '' }]
  const expanded = next.filter((w) => !w.minimized)
  if (expanded.length > MAX_EXPANDED) {
    const oldest = expanded[0] as ComposeWindow
    next = next.map((w) => (w.id === oldest.id ? { ...w, minimized: true } : w))
  }
  // The drafts are saved, so dropping the oldest minimized window loses nothing.
  while (next.length > MAX_WINDOWS) {
    const drop = next.find((w) => w.minimized) ?? (next[0] as ComposeWindow)
    next = next.filter((w) => w.id !== drop.id)
  }
  publish(next)
}

export function closeCompose(id: string): void {
  publish(windows.filter((w) => w.id !== id))
}

export function setComposeMinimized(id: string, minimized: boolean): void {
  publish(windows.map((w) => (w.id === id ? { ...w, minimized } : w)))
}

export function setComposeTitle(id: string, title: string): void {
  if (windows.find((w) => w.id === id)?.title === title) return
  publish(windows.map((w) => (w.id === id ? { ...w, title } : w)))
}

export function useComposeWindows(): ComposeWindow[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => windows,
  )
}
