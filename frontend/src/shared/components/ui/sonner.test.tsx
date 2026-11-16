// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { t } from '@/shared/lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// sonner.tsx calls window.matchMedia at import time, which jsdom does not have.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

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
  document.body.innerHTML = ''
})

describe('AppToaster', () => {
  it('the close button is labelled in the app language, not Sonner’s "Close toast"', async () => {
    const { AppToaster } = await import('./sonner')
    await act(async () => root.render(<AppToaster />))
    await act(async () => {
      toast('Saved')
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const close = document.querySelector('[data-sonner-toast] [data-close-button]')
    expect(close).not.toBeNull()
    expect(close!.getAttribute('aria-label')).toBe(t('common:actions.close'))
  })
})
