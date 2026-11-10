import { describe, expect, it } from 'vitest'
import type { FilterClause } from '@/shared/lib/filters'
import { DEFAULT_COLUMNS } from './columns'
import type { ProspectView } from './types'
import { isViewDirty, nextSort, parseSearchHistory, pushSearchHistory, settingsFromView, viewBody, type ViewSettings } from './view-state'

const status: FilterClause = { field: 'status', op: 'in', value: ['new'] }
const county: FilterClause = { field: 'county', op: 'in', value: ['Brasov'] }

function view(overrides: Partial<ProspectView> = {}): ProspectView {
  return {
    id: 'v1',
    name: 'Acme leads',
    kind: 'companies',
    q: '',
    filters: [status, county],
    columns: [],
    sort: null,
    calcs: {},
    layout: 'list',
    shared: false,
    notifyNew: false,
    ownerId: 'u1',
    ownerName: 'Ana',
    isMine: true,
    starred: false,
    ...overrides,
  }
}

describe('isViewDirty', () => {
  it('is clean right after applying the view', () => {
    const v = view()
    expect(isViewDirty(v, settingsFromView(v))).toBe(false)
  })

  it('ignores the order the filters were added in', () => {
    const v = view()
    expect(isViewDirty(v, { ...settingsFromView(v), f: [county, status] })).toBe(false)
  })

  it('treats a view saved with no columns as the default columns', () => {
    const v = view({ columns: [] })
    expect(settingsFromView(v).columns).toEqual(DEFAULT_COLUMNS)
    expect(isViewDirty(v, { ...settingsFromView(v), columns: [...DEFAULT_COLUMNS] })).toBe(false)
  })

  it.each<[string, Partial<ViewSettings>]>([
    ['a removed filter', { f: [status] }],
    ['another kind', { kind: 'people' }],
    ['another search text', { q: 'acme' }],
    ['another sort', { sort: { key: 'name', dir: 'asc' } }],
    ['reordered columns', { columns: ['status', 'owner'] }],
    ['a calc', { calcs: { score: 'avg' } }],
  ])('is dirty after %s', (_label, change) => {
    const v = view()
    expect(isViewDirty(v, { ...settingsFromView(v), ...change })).toBe(true)
  })
})

describe('viewBody', () => {
  it('sends exactly what the backend view schema stores', () => {
    const settings = settingsFromView(view({ sort: { key: 'score', dir: 'desc' }, calcs: { value: 'sum' } }))
    expect(Object.keys(viewBody(settings)).sort()).toEqual(['calcs', 'columns', 'filters', 'kind', 'q', 'sort'])
  })
})

describe('nextSort', () => {
  it('goes natural direction, opposite direction, then back to the default order', () => {
    const first = nextSort(null, 'score')
    expect(first).toEqual({ key: 'score', dir: 'desc' })
    const second = nextSort(first, 'score')
    expect(second).toEqual({ key: 'score', dir: 'asc' })
    expect(nextSort(second, 'score')).toBeNull()
  })

  it('starts names ascending and a new column from its own direction', () => {
    expect(nextSort({ key: 'score', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('search history', () => {
  it('keeps the newest ten, without repeats', () => {
    let history = pushSearchHistory([], { q: 'a', f: [] })
    for (let i = 0; i < 12; i++) history = pushSearchHistory(history, { q: `q${i}`, f: [] })
    history = pushSearchHistory(history, { q: 'q5', f: [] })
    expect(history).toHaveLength(10)
    expect(history[0]?.q).toBe('q5')
    expect(history.filter((entry) => entry.q === 'q5')).toHaveLength(1)
  })

  it('records nothing for an empty search', () => {
    expect(pushSearchHistory([], { q: '  ', f: [] })).toEqual([])
  })

  it('reads a damaged value as no history', () => {
    expect(parseSearchHistory('{oops')).toEqual([])
    expect(parseSearchHistory(JSON.stringify([{ q: 1 }, { q: 'ok', f: [] }]))).toEqual([{ q: 'ok', f: [] }])
  })
})
