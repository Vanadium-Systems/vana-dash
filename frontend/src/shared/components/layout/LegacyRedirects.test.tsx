// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { legacyAccountingTarget, LegacyAccountingTabs, RedirectPricing } from './LegacyRedirects'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let at = ''

function Probe() {
  const location = useLocation()
  at = location.pathname + location.search
  return null
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function visit(initial: string) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/pricing" element={<RedirectPricing />} />
          <Route path="/accounting" element={<LegacyAccountingTabs><Probe /></LegacyAccountingTabs>} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
}

describe('redirects into Clienți', () => {
  it('/accounting?tab=clienti → /clients?tab=activi', () => {
    visit('/accounting?tab=clienti')
    expect(at).toBe('/clients?tab=activi')
  })

  it('/accounting?tab=contracte → /clients?tab=contracte, cu restul parametrilor', () => {
    visit('/accounting?tab=contracte&client=c1')
    expect(at).toBe('/clients?tab=contracte&client=c1')
  })

  it('celelalte taburi din Facturi rămân unde sunt', () => {
    visit('/accounting?tab=emise')
    expect(at).toBe('/accounting?tab=emise')
    expect(legacyAccountingTarget('')).toBeNull()
  })

  it('/pricing păstrează query-ul', () => {
    visit('/pricing?tab=calculator&prospectId=p1')
    expect(at).toBe('/clients?tab=calculator&prospectId=p1')
  })
})
