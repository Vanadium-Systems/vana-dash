// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScoreSection } from './ScoreSection'
import { t } from '@/shared/lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('@/shared/lib/api', () => ({ api }))
vi.mock('./use-clause-fields', () => ({ useClauseFields: () => [] }))
vi.mock('./ClauseEditor', () => ({ ClauseEditor: () => null }))

const CONFIG = {
  budgetWeight: '0.25',
  needWeight: '0.25',
  techWeight: '0.25',
  contactWeight: '0.25',
  baseWeight: '0.5',
  hotThreshold: 80,
  warmThreshold: 60,
  nurtureThreshold: 40,
  labels: { excellent: 80, good: 60, fit: 40 },
  criteria: [{ id: 'c1', name: 'Has website', points: 10, filters: [{ field: 'website', op: 'is_set' }] }],
}
const DISTRIBUTION = { total: 10, distribution: [{ label: 'excellent', count: 4 }, { label: 'good', count: 6 }] }

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  api.get.mockReset()
  api.post.mockReset()
  api.put.mockReset()
  api.get.mockImplementation(async (url: string) => (url === '/api/prospects/scoring-config' ? CONFIG : []))
  api.post.mockResolvedValue(DISTRIBUTION)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ScoreSection canEdit />
      </QueryClientProvider>,
    )
  })
  // The first draft is the empty default, the second the loaded config; the tests count from here.
  await advance(600)
  await advance(600)
  api.post.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
const previewCalls = () => api.post.mock.calls.filter(([url]) => url === '/api/prospects/scoring/preview')
const thresholdInputs = () => [...container.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')]
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('ScoreSection distribution preview', () => {
  it('shows the counts of the last preview', () => {
    expect(container.textContent).toContain(t('clients:settings.score.total', { n: '10' }))
    expect(container.querySelectorAll('aside li')).toHaveLength(2)
  })

  it('sends no request while the edits are still within the debounce window', async () => {
    await type(thresholdInputs()[0]!, '85')
    await advance(300)
    expect(previewCalls()).toHaveLength(0)
  })

  it('several rapid edits produce one request, with the final values', async () => {
    const [excellent] = thresholdInputs()
    for (const value of ['81', '82', '83', '84']) {
      await type(excellent!, value)
      await advance(100)
    }
    expect(previewCalls()).toHaveLength(0)
    await advance(500)
    expect(previewCalls()).toHaveLength(1)
    expect(previewCalls()[0]![1]).toMatchObject({ labels: { excellent: 84, good: 60, fit: 40 }, baseWeight: 0.5 })
  })

  it('the wait restarts on every edit', async () => {
    const [excellent] = thresholdInputs()
    await type(excellent!, '85')
    await advance(400)
    await type(excellent!, '86')
    await advance(400)
    expect(previewCalls()).toHaveLength(0)
    await advance(150)
    expect(previewCalls()).toHaveLength(1)
  })

  it('thresholds out of order send no request and show the error', async () => {
    const [, good] = thresholdInputs()
    await type(good!, '95')
    await advance(1000)
    expect(previewCalls()).toHaveLength(0)
    expect(container.textContent).toContain(t('clients:settings.score.thresholdsInvalid'))
    expect(container.textContent).toContain(t('clients:settings.score.incomplete'))
  })

  it('a criterion still being written does not change the previewed draft', async () => {
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(t('clients:settings.score.addCriterion')))!
    await act(async () => add.click())
    await advance(1000)
    expect(previewCalls()).toHaveLength(0)
  })
})
