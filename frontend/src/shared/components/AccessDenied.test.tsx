// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireFeature } from './AccessDenied'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import type { SessionPayload } from '@/shared/lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function render(feature: string, features: string[], admin: string | null = 'Ana Popa') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const session = {
    user: { id: 'u1', email: 'ion@vanadium.systems', displayName: 'Ion', role: { id: 'r1', name: 'Sales', kind: 'custom' as const }, status: 'active' as const },
    features,
    isPlatformAdmin: false,
    mailboxes: ['sales'],
    notificationPrefs: { chat: 'all' as const, emailNew: true, alerts: true },
    navLayout: null,
    updatesSeenAt: null,
  } satisfies SessionPayload
  queryClient.setQueryData(ME_QUERY_KEY, session)
  queryClient.setQueryData(['team', 'members'], admin ? [{ id: 'a1', displayName: admin, email: 'ana@vanadium.systems', status: 'active', lastSeenAt: null, role: { id: 'r0', name: 'Admin', kind: 'admin' } }] : [])
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RequireFeature feature={feature} page="Facturi">
            <p>Facturile mele</p>
          </RequireFeature>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('RequireFeature', () => {
  it('lasă pagina să se deschidă când omul are funcționalitatea', () => {
    render('facturi.view', ['facturi.view', 'facturi.emitere'])
    expect(container.textContent).toBe('Facturile mele')
  })

  it('spune ce lipsește și de la cine, nu 404', () => {
    render('facturi.view', ['clienti.view'])
    expect(container.textContent).toContain('Nu ai acces la Facturi')
    expect(container.textContent).toContain('Cere-l de la Ana Popa')
    expect(container.textContent).not.toContain('Facturile mele')
  })

  it('fără admin cunoscut, cere unui administrator', () => {
    render('facturi.view', [], null)
    expect(container.textContent).toContain('Cere-le unui administrator')
  })
})
