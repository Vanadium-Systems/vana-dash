// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientsTab } from './ClientsTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('@/shared/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/api')>()),
  api,
}))
vi.mock('@/shared/hooks/use-me', () => ({ useMe: () => ({ can: () => true, canAny: () => true }) }))
vi.mock('@/shared/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('./ClientFormDialog', () => ({
  ClientFormDialog: ({ open, client }: { open: boolean; client: { name: string } | null }) =>
    open ? <div data-testid="card">{client?.name}</div> : null,
}))

function Where() {
  return <div data-testid="where">{useLocation().search}</div>
}

const acme = { id: 'c-1', name: 'Acme SRL', needsBillingInfo: false }
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  api.get.mockImplementation(async (url: string) => (url === '/api/invoicing/clients' ? [acme] : []))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ClientsTab ?client=', () => {
  it("opens the linked client's card once and drops the param", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/clients?tab=activi&client=c-1']}>
            <ClientsTab />
            <Where />
          </MemoryRouter>
        </QueryClientProvider>,
      )
    })
    await vi.waitFor(() => expect(container.querySelector('[data-testid="card"]')?.textContent).toBe('Acme SRL'))
    expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('?tab=activi')
  })
})
