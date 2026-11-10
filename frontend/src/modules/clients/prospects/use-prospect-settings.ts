import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFilterState, useSearchState } from '@/shared/components/FilterBar'
import { useUrlState } from '@/shared/hooks/use-url-state'
import type { FilterClause } from '@/shared/lib/filters'
import { resolveColumns, type ColumnKey } from './columns'
import type { CalcFn, ProspectKind, SortState } from './types'
import { isSortKey, parseSearchHistory, pushSearchHistory, type SearchEntry, type ViewSettings } from './view-state'

const COLUMNS_STORAGE = 'vd.prospects.columns'
const CALCS_STORAGE = 'vd.prospects.calcs'
const HISTORY_STORAGE = 'vd.prospects.searches'

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Kept for this visit only.
  }
}

function readCalcs(): Record<string, CalcFn> {
  const raw = readJson(CALCS_STORAGE)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, CalcFn>) : {}
}

/**
 * The list's working state. Filters, search, kind, sort and the open view are in the URL (a link
 * reproduces the screen); columns and calcs are kept per browser, and a view replaces them on apply.
 */
export function useProspectSettings() {
  const [f, setF] = useFilterState()
  const [q, setQ] = useSearchState()
  const [kindParam, setKindParam] = useUrlState('kind')
  const [sortParam, setSortParam] = useUrlState('sort')
  const [dirParam, setDirParam] = useUrlState('dir')
  const [viewId, setViewId] = useUrlState('view')
  const [columns, setColumnsState] = useState<ColumnKey[]>(() => resolveColumns(readJson(COLUMNS_STORAGE) as string[] | null))
  const [calcs, setCalcsState] = useState<Record<string, CalcFn>>(readCalcs)

  const kind: ProspectKind = kindParam === 'people' ? 'people' : 'companies'
  const sort = useMemo<SortState | null>(() => (isSortKey(sortParam) ? { key: sortParam, dir: dirParam === 'asc' ? 'asc' : 'desc' } : null), [sortParam, dirParam])

  const setKind = useCallback((next: ProspectKind) => setKindParam(next === 'people' ? 'people' : ''), [setKindParam])
  const setSort = useCallback(
    (next: SortState | null) => {
      setSortParam(next?.key ?? '')
      setDirParam(next?.dir ?? '')
    },
    [setSortParam, setDirParam],
  )
  const setColumns = useCallback((next: ColumnKey[]) => {
    setColumnsState(next)
    writeJson(COLUMNS_STORAGE, next)
  }, [])
  const setCalcs = useCallback((next: Record<string, CalcFn>) => {
    setCalcsState(next)
    writeJson(CALCS_STORAGE, next)
  }, [])

  const current = useMemo<ViewSettings>(() => ({ q, f, kind, sort, columns, calcs }), [q, f, kind, sort, columns, calcs])

  const apply = useCallback(
    (settings: ViewSettings, id: string) => {
      setF(settings.f)
      setKind(settings.kind)
      setSort(settings.sort)
      setColumns(settings.columns)
      setCalcs(settings.calcs)
      setQ(settings.q)
      setViewId(id)
    },
    [setF, setKind, setSort, setColumns, setCalcs, setQ, setViewId],
  )

  return { f, setF, q, setQ, kind, setKind, sort, setSort, columns, setColumns, calcs, setCalcs, viewId, setViewId, current, apply }
}

export type ProspectSettings = ReturnType<typeof useProspectSettings>

/** The last ten searches, recorded once the person stops changing them. */
export function useSearchHistory(q: string, f: FilterClause[]): [SearchEntry[], (entry: SearchEntry) => void] {
  const [history, setHistory] = useState<SearchEntry[]>(() => parseSearchHistory(localStorage.getItem(HISTORY_STORAGE)))
  const record = useCallback((entry: SearchEntry) => {
    setHistory((old) => {
      const next = pushSearchHistory(old, entry)
      if (next !== old) writeJson(HISTORY_STORAGE, next)
      return next
    })
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => record({ q, f }), 2000)
    return () => clearTimeout(timer)
  }, [q, f, record])
  return [history, record]
}
