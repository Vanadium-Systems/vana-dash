import type { FilterClause } from '@/shared/lib/filters'
import { resolveColumns, sameColumns, type ColumnKey } from './columns'
import type { CalcFn, ProspectKind, ProspectView, SortKey, SortState } from './types'

/** What a saved view stores. */
export interface ViewSettings {
  q: string
  f: FilterClause[]
  kind: ProspectKind
  sort: SortState | null
  columns: ColumnKey[]
  calcs: Record<string, CalcFn>
}

export const SORT_KEYS: SortKey[] = ['score', 'name', 'updatedAt', 'createdAt', 'lastActivityAt', 'value', 'expectedCloseAt', 'daysInStage', 'nextTask']
export const isSortKey = (key: string): key is SortKey => (SORT_KEYS as string[]).includes(key)

const ASC_FIRST: SortKey[] = ['name', 'nextTask']

/** Header click: first the natural direction of the column, then the other one, then back to the default order. */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  const first = ASC_FIRST.includes(key) ? 'asc' : 'desc'
  if (current?.key !== key) return { key, dir: first }
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' }
  return null
}

export function settingsFromView(view: ProspectView): ViewSettings {
  return { q: view.q, f: view.filters, kind: view.kind, sort: view.sort, columns: resolveColumns(view.columns), calcs: view.calcs }
}

/** The body of POST / PATCH `/api/prospects/views`. */
export function viewBody(settings: ViewSettings) {
  return { q: settings.q.trim(), kind: settings.kind, filters: settings.f, columns: settings.columns, sort: settings.sort, calcs: settings.calcs }
}

// Clause order is the order they were added in; two filters with the same clauses are the same filter.
const canonicalFilters = (f: FilterClause[]) => f.map((clause) => JSON.stringify(clause)).sort()
const canonicalCalcs = (calcs: Record<string, CalcFn>) => Object.entries(calcs).sort(([a], [b]) => a.localeCompare(b))

export function sameSettings(a: ViewSettings, b: ViewSettings): boolean {
  return (
    a.kind === b.kind &&
    a.q.trim() === b.q.trim() &&
    a.sort?.key === b.sort?.key &&
    a.sort?.dir === b.sort?.dir &&
    sameColumns(a.columns, b.columns) &&
    JSON.stringify(canonicalFilters(a.f)) === JSON.stringify(canonicalFilters(b.f)) &&
    JSON.stringify(canonicalCalcs(a.calcs)) === JSON.stringify(canonicalCalcs(b.calcs))
  )
}

export const isViewDirty = (view: ProspectView, current: ViewSettings) => !sameSettings(settingsFromView(view), current)

export interface SearchEntry {
  q: string
  f: FilterClause[]
}

export const MAX_SEARCH_HISTORY = 10

const entryKey = (entry: SearchEntry) => JSON.stringify([entry.q.trim(), canonicalFilters(entry.f)])

/** Newest first, no repeats, empty searches never recorded. */
export function pushSearchHistory(history: SearchEntry[], entry: SearchEntry): SearchEntry[] {
  if (!entry.q.trim() && entry.f.length === 0) return history
  const key = entryKey(entry)
  return [entry, ...history.filter((old) => entryKey(old) !== key)].slice(0, MAX_SEARCH_HISTORY)
}

export function parseSearchHistory(raw: string | null): SearchEntry[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is SearchEntry => Boolean(entry) && typeof entry.q === 'string' && Array.isArray(entry.f))
      .slice(0, MAX_SEARCH_HISTORY)
  } catch {
    return []
  }
}
