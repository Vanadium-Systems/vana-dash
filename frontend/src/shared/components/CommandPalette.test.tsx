// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import type { SessionPayload } from '@/shared/lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let currentPath = ''
let session: SessionPayload

function LocationProbe() {
  const location = useLocation()
  currentPath = location.pathname + location.search
  return null
}

beforeAll(() => {
  // cmdk măsoară elementele și derulează la itemul selectat; jsdom nu are aceste API-uri.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})

function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(ME_QUERY_KEY, session)
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
          <CommandPalette open onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  currentPath = ''
  // Admin cu tot catalogul — fiecare test ajustează ce îi trebuie.
  session = {
    user: { id: 'u1', email: 'stefan@vanadium.systems', displayName: 'Stefan', role: { id: 'r1', name: 'Admin', kind: 'admin' }, status: 'active' },
    features: ['facturi.view', 'facturi.emitere', 'email.view', 'calendar.view', 'calendar.editare', 'notite.view', 'setari.view'],
    isPlatformAdmin: true,
    mailboxes: null,
    notificationPrefs: { chat: 'all', emailNew: true, alerts: true },
    navLayout: null,
    updatesSeenAt: null,
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function type(text: string) {
  const input = document.querySelector('[cmdk-input]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

function items() {
  return [...document.querySelectorAll('[cmdk-item]')].map((el) => el.textContent)
}

describe('CommandPalette', () => {
  it('tastare + Enter navighează la pagină, fără diacritice în căutare', () => {
    render()
    const input = type('setari')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(currentPath).toBe('/settings')
  })

  it('acțiunile duc la pagina cu dialogul deschis', () => {
    render()
    const input = type('factura noua')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(currentPath).toBe('/accounting?tab=emise&new=1')
  })

  it('ascunde paginile și acțiunile pe care omul nu le are', () => {
    render()
    expect(items().join('|')).not.toContain('Investiții')
    // `blochează interval` cere calendar.programari, pe care omul nu o are.
    expect(items().join('|')).not.toContain('Blochează interval')
    expect(items().join('|')).toContain('Facturi')
  })

  it('căutarea în date vine de pe server și duce la obiectul găsit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            group: 'Clienți',
            feature: 'clienti.view',
            items: [{ id: 'p1', label: 'Acme SRL', sublabel: 'Ion Pop · RO123', to: '/pricing?prospect=p1' }],
          },
        ],
      }),
    })
    session.features = [...session.features, 'clienti.view']
    vi.stubGlobal('fetch', fetchMock)
    render()

    type('acme')
    // Debounce de 250ms + cererea serverului; sub su Load, timerele pot întârzia, deci
    // așteptăm în trei pași și întrebăm React Query de fiecare dată.
    for (let i = 0; i < 5 && !items().join('|').includes('Acme'); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150))
      })
    }

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/search?q=acme'), expect.anything())
    expect(items().join('|')).toContain('Acme SRL')

    act(() => document.querySelector('[cmdk-item]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(currentPath).toBe('/pricing?prospect=p1')
  })
})
