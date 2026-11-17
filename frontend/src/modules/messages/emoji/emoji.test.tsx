// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../Composer'
import { loadEmoji } from './data'
import { isEmojiOnly } from './emoji-only'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/shared/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/api')>()), api: { post: vi.fn(async () => ({})), get: vi.fn() } }))

describe('isEmojiOnly', () => {
  it('accepts one to three emoji, with or without spaces', () => {
    expect(isEmojiOnly('😭')).toBe(true)
    expect(isEmojiOnly('😭😭😭')).toBe(true)
    expect(isEmojiOnly(' 😭 😂 👍 ')).toBe(true)
  })
  it('counts skin tones, ZWJ families and flags as one', () => {
    expect(isEmojiOnly('👍🏽')).toBe(true)
    expect(isEmojiOnly('👨‍👩‍👧')).toBe(true)
    expect(isEmojiOnly('🇷🇴')).toBe(true)
    expect(isEmojiOnly('🏴󠁧󠁢󠁥󠁮󠁧󠁿')).toBe(true)
    expect(isEmojiOnly('❤️')).toBe(true)
    expect(isEmojiOnly('👨‍👩‍👧👍🏽🇷🇴')).toBe(true)
  })
  it('rejects four emoji, text and digits', () => {
    expect(isEmojiOnly('😭😭😭😭')).toBe(false)
    expect(isEmojiOnly('😭 salut')).toBe(false)
    expect(isEmojiOnly('1')).toBe(false)
    expect(isEmojiOnly('')).toBe(false)
  })
})

describe('Composer emoji', () => {
  let container: HTMLDivElement
  let root: Root
  const onSend = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onSend.mockClear()
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const textarea = () => container.querySelector('textarea') as HTMLTextAreaElement

  // The data loads through a dynamic import (slow the first time); let it settle.
  const settled = () =>
    act(async () => {
      await loadEmoji()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

  async function type(text: string) {
    const el = textarea()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      el.focus()
      setter.call(el, text)
      el.setSelectionRange(text.length, text.length)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settled()
  }

  const key = (k: string) =>
    act(async () => {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Composer conversationId="c1" onSend={onSend} />
        </QueryClientProvider>,
      )
    })
  }

  it('lists 😭 for :so, inserts it on Enter without sending', async () => {
    await mount()
    await type(':so')
    const options = [...container.querySelectorAll('[role="option"]')]
    expect(options.map((o) => o.textContent)).toContain('😭:sob:')
    expect(textarea().getAttribute('aria-activedescendant')).toBeTruthy()
    const sobIndex = options.findIndex((o) => o.textContent?.startsWith('😭'))
    for (let i = 0; i < sobIndex; i++) await key('ArrowDown')
    await key('Enter')
    expect(textarea().value).toBe('😭')
    expect(onSend).not.toHaveBeenCalled()
    expect(container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('closes the list on Esc and keeps the text', async () => {
    await mount()
    await type('hi :so')
    expect(container.querySelector('[role="listbox"]')).not.toBeNull()
    await key('Escape')
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(textarea().value).toBe('hi :so')
  })

  it('does not open in the middle of a word', async () => {
    await mount()
    await type('ora12:30')
    expect(container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('replaces a finished :sob: on its own', async () => {
    await mount()
    await type(':sob')
    await type(':sob:')
    expect(textarea().value).toBe('😭')
  })

  it('inserts the picked emoji at the cursor', async () => {
    await mount()
    await type('abcd')
    textarea().setSelectionRange(2, 2)
    const open = container.querySelector('button[aria-label="Emoji"], button[aria-label="emoji.open"]') as HTMLButtonElement
    expect(open).not.toBeNull()
    await act(async () => open.click())
    await settled()
    const cell = container.querySelector('[role="dialog"] button[aria-label="loudly crying face"]') as HTMLButtonElement
    await act(async () => cell.click())
    expect(textarea().value).toBe('ab😭cd')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
