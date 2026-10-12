// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantText } from './AssistantText'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('AssistantText', () => {
  // regresie: referințele [[type:id|etichetă]] crăpau pagina Asistent (match null pe segmentul deja despărțit)
  it('randează referințele ca chip-uri, lângă markdown', () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <AssistantText text="Vezi [[invoice:abc-123|Factura VS-0042]] și **restul**." />
        </MemoryRouter>,
      ),
    )
    expect(container.textContent).toContain('Factura VS-0042')
    expect(container.textContent).toContain('restul')
    expect(container.textContent).not.toContain('[[')
  })
})
