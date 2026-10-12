// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RedirectToTab } from './PageSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let current = ''

function Probe() {
  const location = useLocation()
  current = location.pathname + location.search
  return null
}

function renderAt(url: string) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/reports" element={<RedirectToTab to="/financials" tab="rapoarte" />} />
          <Route path="/plan" element={<RedirectToTab to="/notes" tab="plan" />} />
          <Route path="/wishlist" element={<RedirectToTab to="/notes" tab="wishlist" />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
}

beforeEach(() => {
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(() => act(() => root.unmount()))

describe('rutele vechi duc la tab-ul nou', () => {
  it('/reports păstrează perioada', () => {
    renderAt('/reports?period=90d')
    expect(current).toBe('/financials?period=90d&tab=rapoarte')
  })

  it('/plan păstrează scope', () => {
    renderAt('/plan?scope=firma')
    expect(current).toBe('/notes?scope=firma&tab=plan')
  })

  it('/wishlist mută filtrul vechi din tab în tip', () => {
    renderAt('/wishlist?tab=placere')
    expect(current).toBe('/notes?tip=placere&tab=wishlist')
  })
})
