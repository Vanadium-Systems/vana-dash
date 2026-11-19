// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from './dialog'
import { Select } from './select'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

// A modal dialog blocks clicks outside its content (pointer-events on body) and pulls focus back,
// so a list portaled to <body> could be seen but not picked from.
it('inside a dialog, the list is mounted in the dialog and a click picks the option', () => {
  const onValueChange = vi.fn()
  act(() =>
    root.render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>t</DialogTitle>
          <Select value="4" onValueChange={onValueChange} options={[{ value: '1', label: '1 h' }, { value: '4', label: '4 h' }]} />
        </DialogContent>
      </Dialog>,
    ),
  )
  const dialog = document.querySelector('[role="dialog"]')!
  act(() => dialog.querySelector<HTMLButtonElement>('[role="combobox"]')!.click())
  const list = document.querySelector('[role="listbox"]')!
  expect(dialog.contains(list)).toBe(true)
  act(() => [...list.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === '1 h')!.click())
  expect(onValueChange).toHaveBeenCalledWith('1')
})
