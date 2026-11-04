// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmailDraft } from '@/shared/lib/types'
import { closeCompose, openCompose, useComposeWindows, type ComposeWindow } from './compose-store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The store is module state read through a hook, so a probe component keeps the latest value.
let current: ComposeWindow[] = []
function Probe() {
  current = useComposeWindows()
  return null
}

let root: ReturnType<typeof createRoot>

const draft = (id: string): EmailDraft => ({
  id,
  fromKey: 'stefan',
  to: 'ana@example.com',
  cc: '',
  subject: 'Hello',
  body: '',
  templateId: null,
  attachments: [],
  mode: 'new',
  threadId: null,
  sourceMessageId: null,
  updatedAt: '2026-11-01T10:00:00Z',
} as EmailDraft)

const open = (init: Parameters<typeof openCompose>[0]) => act(() => openCompose(init))

beforeEach(() => {
  root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
})

afterEach(() => {
  for (const w of [...current]) act(() => closeCompose(w.id))
  act(() => root.unmount())
})

describe('compose-store', () => {
  it('minimizes the oldest window when a third one opens', () => {
    open({ kind: 'new' })
    open({ kind: 'new' })
    open({ kind: 'new' })
    expect(current).toHaveLength(3)
    expect(current.map((w) => w.minimized)).toEqual([true, false, false])
  })

  it('focuses a draft that is already open instead of adding a copy', () => {
    open({ kind: 'draft', draft: draft('d1') })
    const id = (current[0] as ComposeWindow).id
    open({ kind: 'draft', draft: draft('d1') })
    expect(current).toHaveLength(1)
    expect((current[0] as ComposeWindow).id).toBe(id)
    expect((current[0] as ComposeWindow).minimized).toBe(false)
  })

  it('brings a minimized duplicate back to expanded', () => {
    open({ kind: 'draft', draft: draft('d1') })
    open({ kind: 'new' })
    open({ kind: 'new' })
    expect((current[0] as ComposeWindow).minimized).toBe(true)
    open({ kind: 'draft', draft: draft('d1') })
    expect(current).toHaveLength(3)
    expect((current[0] as ComposeWindow).minimized).toBe(false)
  })

  it('removes a window on close', () => {
    open({ kind: 'new' })
    open({ kind: 'new' })
    const first = (current[0] as ComposeWindow).id
    act(() => closeCompose(first))
    expect(current).toHaveLength(1)
    expect(current.some((w) => w.id === first)).toBe(false)
  })

  it('keeps at most 4 windows, dropping the oldest minimized one', () => {
    for (let i = 0; i < 6; i++) open({ kind: 'new' })
    expect(current).toHaveLength(4)
    expect(current.filter((w) => !w.minimized)).toHaveLength(2)
  })
})
