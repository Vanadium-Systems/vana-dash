// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, Toaster } from './toast'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  toast.dismiss()
})

afterEach(() => {
  toast.dismiss()
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('toast', () => {
  it('renders toast(), success, error, info, warning, description, and action', () => {
    const onAction = vi.fn()
    act(() => root.render(<Toaster />))

    act(() => {
      toast('Plain')
      toast.success('Done', { description: 'All good', action: { label: 'Undo', onClick: onAction } })
      toast.error('Failed')
      toast.info('Note')
      toast.warning('Careful')
    })

    const nodes = container.querySelectorAll('[data-sonner-toast]')
    expect(nodes).toHaveLength(5)
    expect(container.textContent).toContain('Plain')
    expect(container.textContent).toContain('All good')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Failed')

    const undoBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!
    act(() => undoBtn.click())
    expect(onAction).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('[data-sonner-toast]')).toHaveLength(4)
  })

  it('caps the stack at 5 toasts and supports dismiss(id)', () => {
    act(() => root.render(<Toaster />))
    let firstId: string | number = ''
    act(() => {
      firstId = toast('1')
      toast('2')
      toast('3')
      toast('4')
      toast('5')
      toast('6')
    })
    expect(container.querySelectorAll('[data-sonner-toast]')).toHaveLength(5)
    expect(container.textContent).not.toContain('1')
    expect(container.textContent).toContain('6')

    act(() => toast.dismiss(firstId))
    expect(container.querySelectorAll('[data-sonner-toast]')).toHaveLength(5)

    act(() => toast.dismiss())
    expect(container.querySelectorAll('[data-sonner-toast]')).toHaveLength(0)
  })

  it('auto-dismisses after duration and pauses on hover', () => {
    vi.useFakeTimers()
    act(() => root.render(<Toaster />))

    act(() => {
      toast('Timed', { duration: 1000 })
    })
    const el = container.querySelector('[data-sonner-toast]')!
    act(() => {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(2000))
    expect(container.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)

    act(() => {
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(1000))
    expect(container.querySelectorAll('[data-sonner-toast]')).toHaveLength(0)
  })
})
