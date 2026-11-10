// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '@/shared/components/ui/confirm-dialog'
import { t } from '@/shared/lib/i18n'
import { ArchivePage } from './ArchivePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({ get: vi.fn() }))
const me = vi.hoisted(() => ({ features: new Set<string>() }))
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
vi.mock('@/shared/lib/api', () => ({ api }))
vi.mock('@/shared/hooks/use-me', () => ({
  useMe: () => ({ session: { user: { id: 'u1' } }, can: (f: string) => me.features.has(f), canAny: () => false, isPending: false, isError: false }),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

async function mount(features: string[]) {
  me.features = new Set(features)
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/archive/spaces') return { own: null, spaces: null, shared: [] }
    if (url.startsWith('/api/archive/files')) return { items: [], total: 0 }
    return []
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={['/archive']}>
            <ArchivePage />
          </MemoryRouter>
        </ConfirmProvider>
      </QueryClientProvider>,
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  api.get.mockReset()
})

const spaceTab = () => Array.from(container!.querySelectorAll('[role="tab"]')).find((el) => el.textContent === t('archive:tabs.space'))

describe('Archive storage tab', () => {
  it('is hidden and never fetched without arhiva.spatiu', async () => {
    await mount(['arhiva.view'])
    expect(spaceTab()).toBeUndefined()
    expect(api.get).not.toHaveBeenCalledWith('/api/archive/storage-usage')
  })

  it('shows up with arhiva.spatiu', async () => {
    await mount(['arhiva.view', 'arhiva.spatiu'])
    expect(spaceTab()).toBeDefined()
  })
})
