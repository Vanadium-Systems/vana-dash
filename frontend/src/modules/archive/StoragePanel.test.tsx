// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/shared/lib/i18n'
import { formatBytes } from '@/shared/lib/utils'
import { StoragePanel, usageTone } from './StoragePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/lib/api', () => ({ api }))

const GB = 1024 ** 3
const usage = (usedBytes: number) => ({
  limitBytes: 10 * GB,
  usedBytes,
  uncounted: ['quarterly-packages'],
  bySource: [
    { source: 'arhiva', bytes: 2 * GB, files: 12 },
    { source: 'note_vocale', bytes: GB / 2, files: 3 },
    { source: 'mesaje', bytes: GB / 4, files: 7 },
  ],
  byPerson: [
    { userId: 'u1', name: 'Ana Acme', bytes: 2 * GB, bySource: { arhiva: 2 * GB, note_vocale: 0, mesaje: 0 } },
    { userId: null, name: null, bytes: GB / 2, bySource: { arhiva: 0, note_vocale: GB / 4, mesaje: GB / 4 } },
  ],
  topFolders: [{ folderId: 'f1', name: 'Contracts', ownerName: 'Ana Acme', bytes: GB, files: 5 }],
})

let container: HTMLDivElement
let root: Root

async function mount(data: unknown) {
  api.get.mockResolvedValue(data)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StoragePanel onOpenFolder={() => {}} />
      </QueryClientProvider>,
    )
  })
  await vi.waitFor(() => expect(container.querySelector('[role="progressbar"]')).not.toBeNull())
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

describe('StoragePanel', () => {
  it('shows the totals, the three sources and the unknown person as System', async () => {
    await mount(usage(2.75 * GB))
    const text = container.textContent ?? ''
    expect(api.get).toHaveBeenCalledWith('/api/archive/storage-usage')
    expect(text).toContain(formatBytes(2.75 * GB))
    expect(text).toContain(t('archive:space.sources.arhiva'))
    expect(text).toContain(t('archive:space.sources.note_vocale'))
    expect(text).toContain(t('archive:space.sources.mesaje'))
    expect(text).toContain('Ana Acme')
    expect(text).toContain(t('archive:space.system'))
    expect(text).toContain('Contracts')
    expect(text).toContain(t('archive:space.uncounted.quarterly-packages'))
  })

  it.each([
    [0.5, 'bg-primary'],
    [0.81, 'bg-warning'],
    [0.96, 'bg-destructive'],
  ])('picks the token for %s of the limit', async (ratio, bar) => {
    expect(usageTone(ratio).bar).toBe(bar)
    await mount(usage(ratio * 10 * GB))
    expect(container.querySelector('[data-testid="space-bar"]')?.className).toContain(bar)
  })

  it('keeps the default tone at exactly 80%', () => {
    expect(usageTone(0.8).bar).toBe('bg-primary')
    expect(usageTone(0.95).bar).toBe('bg-warning')
  })
})
