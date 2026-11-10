// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MergeView } from './MergeView'
import { t } from '@/shared/lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/lib/api', () => ({ api }))
const confirm = vi.hoisted(() => vi.fn())
vi.mock('@/shared/components/ui/confirm-dialog', () => ({ useConfirm: () => confirm }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PREVIEW = {
  fields: [
    { field: 'name', master: 'Acme SRL', other: 'Acme S.R.L.', proposed: 'master' },
    { field: 'website', master: null, other: 'https://acme.example.com', proposed: 'other' },
    { field: 'employeeCount', master: 12, other: 40, proposed: 'master' },
  ],
  moves: { people: 2, contactPoints: 0, notes: 3, tasks: 0, listMemberships: 0, enrollments: 0, stageEvents: 0, collaborators: 0, calls: 0 },
}

let container: HTMLDivElement
let root: Root
const onSwap = vi.fn()
const onClose = vi.fn()

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

beforeEach(async () => {
  api.get.mockReset()
  api.post.mockReset()
  confirm.mockReset()
  confirm.mockResolvedValue(true)
  onSwap.mockReset()
  onClose.mockReset()
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/prospects/merge/preview')) return PREVIEW
    if (url.startsWith('/api/prospects/health/duplicates')) return { items: [], total: 0, page: 1, pageSize: 100, checkedAt: null }
    return []
  })
  api.post.mockResolvedValue({ id: 'master-1' })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/clients/health']}>
          <MergeView masterId="master-1" otherId="other-1" onSwap={onSwap} onClose={onClose} />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const radios = (field: string) => [...container.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${field}"]`)]
const mergeButton = () => button(t('clients:health.merge.confirm', { name: 'Acme SRL' }))

describe('MergeView', () => {
  it('requests the preview for the pair and shows both values of every differing field', () => {
    expect(api.get).toHaveBeenCalledWith('/api/prospects/merge/preview?masterId=master-1&otherId=other-1')
    expect(container.textContent).toContain('Acme SRL')
    expect(container.textContent).toContain('Acme S.R.L.')
    expect(container.textContent).toContain('https://acme.example.com')
    expect(container.textContent).toContain(t('clients:health.merge.empty'))
    expect(radios('website')).toHaveLength(2)
  })

  it('starts from the proposed side of each field and lists the records that move', () => {
    expect(radios('name').map((r) => r.checked)).toEqual([true, false])
    expect(radios('website').map((r) => r.checked)).toEqual([false, true])
    const items = [...container.querySelectorAll('ul li')].map((li) => li.textContent)
    expect(items).toEqual([t('clients:health.merge.moves.people', { count: 2 }), t('clients:health.merge.moves.notes', { count: 3 })])
  })

  it('a changed choice goes into the merge body, untouched fields keep the proposal', async () => {
    await act(async () => radios('employeeCount')[1]!.click())
    expect(radios('employeeCount').map((r) => r.checked)).toEqual([false, true])
    await act(async () => mergeButton().click())
    expect(api.post).toHaveBeenCalledWith('/api/prospects/merge', {
      masterId: 'master-1',
      otherId: 'other-1',
      fields: { name: 'master', website: 'other', employeeCount: 'other' },
    })
  })

  it('confirming sends the merge once and then opens the master', async () => {
    await act(async () => mergeButton().click())
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('/clients/master-1')
  })

  it('declining the confirmation sends nothing and stays on the screen', async () => {
    confirm.mockResolvedValue(false)
    await act(async () => mergeButton().click())
    expect(api.post).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('/clients/health')
  })

  it('a failed merge stays on the screen', async () => {
    api.post.mockRejectedValue(new Error('conflict'))
    await act(async () => mergeButton().click())
    expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('/clients/health')
  })

  it('swap and back call the parent handlers', async () => {
    await act(async () => button(t('clients:health.merge.swap')).click())
    expect(onSwap).toHaveBeenCalledTimes(1)
    await act(async () => button(t('common:actions.back')).click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
