// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidAddress, parseAddresses, RecipientField } from './RecipientField'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('parseAddresses', () => {
  it('splits on commas, semicolons and whitespace', () => {
    expect(parseAddresses('a@example.com, b@example.com; c@example.com d@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ])
  })

  it('keeps only the address from "Name <a@b.ro>"', () => {
    expect(parseAddresses('Ana <ana@example.com>, <ion@example.com>')).toEqual(['ana@example.com', 'ion@example.com'])
  })

  it('returns nothing for blank input', () => {
    expect(parseAddresses(' ,; ')).toEqual([])
  })
})

describe('isValidAddress', () => {
  it('accepts plain addresses', () => {
    expect(isValidAddress('ana@example.com')).toBe(true)
    expect(isValidAddress('ana.pop+tag@mail.example.co.uk')).toBe(true)
  })

  it('rejects text that is not an address', () => {
    for (const bad of ['ana', 'ana@', '@example.com', 'ana@example', 'a na@example.com', 'Ana <ana@example.com>']) {
      expect(isValidAddress(bad)).toBe(false)
    }
  })
})

describe('RecipientField', () => {
  let container: HTMLDivElement
  let root: Root
  let onChange: ReturnType<typeof vi.fn<(next: string[]) => void>>

  function Harness({ initial, suggestions = [] }: { initial: string[]; suggestions?: string[] }) {
    const [value, setValue] = useState(initial)
    return createElement(RecipientField, {
      id: 'to',
      label: 'To',
      value,
      suggestions,
      onChange: (next: string[]) => {
        onChange(next)
        setValue(next)
      },
    })
  }

  const render = (initial: string[] = [], suggestions: string[] = []) =>
    act(() => root.render(createElement(Harness, { initial, suggestions })))

  const input = () => container.querySelector('input') as HTMLInputElement

  function type(text: string) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (v: string) => void
      setter.call(input(), text)
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function press(key: string) {
    act(() => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  }

  const chips = () => Array.from(container.querySelectorAll('span[title]')) as HTMLElement[]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onChange = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('turns a typed address followed by "," into a chip', () => {
    render()
    type('ana@example.com')
    press(',')
    expect(onChange).toHaveBeenCalledWith(['ana@example.com'])
    expect(chips().map((c) => c.textContent)).toEqual(['ana@example.com'])
    expect(input().value).toBe('')
  })

  it('removes the last chip on Backspace in an empty input', () => {
    render(['ana@example.com', 'ion@example.com'])
    press('Backspace')
    expect(onChange).toHaveBeenLastCalledWith(['ana@example.com'])
  })

  it('does not remove a chip on Backspace while the input has text', () => {
    render(['ana@example.com'])
    type('io')
    press('Backspace')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps an invalid address as a chip with the destructive style and a title', () => {
    render()
    type('not-an-address')
    press(',')
    expect(onChange).toHaveBeenCalledWith(['not-an-address'])
    const [chip] = chips()
    expect(chip?.className).toContain('text-destructive')
    expect(chip?.getAttribute('title')).toContain('not-an-address')
  })

  it('picks the highlighted suggestion with ArrowDown + Enter', () => {
    render([], ['ana@example.com', 'ion@example.com'])
    act(() => input().focus())
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2)
    press('ArrowDown')
    press('Enter')
    expect(onChange).toHaveBeenCalledWith(['ion@example.com'])
  })
})
