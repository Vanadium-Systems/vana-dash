// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from './dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

// Same trap as the Select: on <body> the menu sat under the dialog's overlay, with no clicks and
// no focus (the note dialog's ⋯ menu, found 2026-11-19).
it('inside a dialog, the menu is mounted in the dialog and its items work', () => {
  const onCopy = vi.fn()
  act(() =>
    root.render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>t</DialogTitle>
          <DropdownMenu>
            <DropdownMenuTrigger>more</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={onCopy}>Copy link</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogContent>
      </Dialog>,
    ),
  )
  const dialog = document.querySelector('[role="dialog"]')!
  act(() => dialog.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  const menu = document.querySelector('[role="menu"]')!
  expect(dialog.contains(menu)).toBe(true)
  expect((menu as HTMLElement).style.position).toBe('absolute')
  act(() => menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(onCopy).toHaveBeenCalledOnce()
})

it('outside a dialog, the menu stays fixed on the body', () => {
  act(() =>
    root.render(
      <DropdownMenu>
        <DropdownMenuTrigger>more</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => {}}>Copy link</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  )
  act(() => document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!
  expect(menu.parentElement).toBe(document.body)
  expect(menu.style.position).toBe('fixed')
})
