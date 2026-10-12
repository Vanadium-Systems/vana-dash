// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import type { SessionPayload } from '@/shared/lib/types'

// Aplicația montată pe ruta de acasă, exact cum o composează `main.tsx`. Testul există pentru
// un caz trăit în prod la deploy: `ChatStreamProvider` pus **în** AppLayout, în timp ce
// AppLayout consumă badge-ul de mesaje necitite. Un context nu ajunge la propria componentă,
// deci `useChatStream()` arunca — pe fiecare pagină, ecranul întreg căzând în ErrorBoundary.
// Providerul trebuie să stea deasupra shell-ului, în arbii de rute.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function renderApp(path: string) {
  const session = {
    user: {
      id: 'u1',
      email: 'stefan@vanadium.systems',
      displayName: 'Stefan',
      role: { id: 'r0', name: 'Admin', kind: 'admin' as const },
      status: 'active' as const,
    },
    features: ['mesaje.view', 'email.view'],
    isPlatformAdmin: true,
    mailboxes: null,
    notificationPrefs: { chat: 'all' as const, emailNew: true, alerts: true },
    navLayout: null,
    updatesSeenAt: null,
    locale: 'ro',
    enabledLocales: ['ro'],
    displayCurrency: 'RON',
    displayCurrencies: ['RON', 'EUR', 'USD'],
  } satisfies SessionPayload

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(ME_QUERY_KEY, session)
  queryClient.setQueryData(['chat', 'conversations'], [])
  queryClient.setQueryData(['email', 'unread-counts'], { inbox: 0, spam: 0, total: 0 })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // `act` async: primul rand trece prin `Suspense` (paginile sunt lazy, importate dinamic).
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  // Paginile sunt lazy: importul lor trebuie să fie deja înregistrat, altfel `Suspense`
  // rămâne pe spinner într-un test care nu așteaptă module noi.
  await import('@/modules/overview/OverviewPage')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'EventSource',
    class {
      readyState = 1
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        this.onopen?.()
      }
      addEventListener() {}
      close() {}
    },
  )
  // Răspuns gol, dar cu forma pe care o așteaptă fiecare widget: `threads` cere
  // `{ items, total }`, nu o listă — altfel pagina Azi ar cădea în test pe `data.items`.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const data = url.includes('/api/email/threads')
        ? { items: [], total: 0 }
        : url.includes('/api/calendar')
          ? { items: [] }
          : []
      return { ok: true, status: 200, json: async () => ({ success: true, data }) }
    }),
  )
  // jsdom nu implementează `matchMedia`, folosit de use-install-prompt la mount.
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Azi, cu provider-ul de flux deasupra shell-ului', () => {
  it('randează shell-ul și pagina, fără să cadă în ErrorBoundary', async () => {
    await renderApp('/')
    expect(container.textContent).toContain('VanaDash')
    expect(container.textContent).toContain('stefan@vanadium.systems')
    expect(container.textContent).toContain('Azi')
  })

  it('Mesajele intră în nav cu `mesaje.view`', async () => {
    await renderApp('/')
    expect(container.querySelector('a[href="/messages"]')).not.toBeNull()
  })
})