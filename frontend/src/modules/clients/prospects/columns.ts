import type { CalcField, CalcFn, SortKey } from './types'

export type ColumnKey =
  | 'owner'
  | 'status'
  | 'score'
  | 'contact'
  | 'note'
  | 'nextTask'
  | 'daysInStage'
  | 'lastActivityAt'
  | 'value'
  | 'expectedCloseAt'
  | 'employees'
  | 'revenue'
  | 'caen'
  | 'source'
  | 'cif'
  | 'createdAt'

export interface ColumnDef {
  key: ColumnKey
  /** `md` drops under 40rem of table width, `lg` under 56rem (ui/table.tsx); the value moves under the name. */
  priority: 'md' | 'lg'
  sort?: SortKey
  calc?: CalcField
  /** Edited in place; needs `canEdit` on the row. */
  editable?: boolean
}

// The company name is not here: it is always the first column and is never hidden.
export const COLUMN_DEFS: ColumnDef[] = [
  { key: 'owner', priority: 'md', editable: true },
  { key: 'status', priority: 'md', editable: true },
  { key: 'score', priority: 'md', sort: 'score', calc: 'score' },
  { key: 'contact', priority: 'md' },
  { key: 'note', priority: 'md' },
  { key: 'nextTask', priority: 'lg', sort: 'nextTask' },
  { key: 'daysInStage', priority: 'lg', sort: 'daysInStage' },
  { key: 'lastActivityAt', priority: 'lg', sort: 'lastActivityAt' },
  { key: 'value', priority: 'lg', sort: 'value', calc: 'value', editable: true },
  { key: 'expectedCloseAt', priority: 'lg', sort: 'expectedCloseAt' },
  { key: 'employees', priority: 'lg', calc: 'employees' },
  { key: 'revenue', priority: 'lg', calc: 'revenue' },
  { key: 'caen', priority: 'lg' },
  { key: 'source', priority: 'lg' },
  { key: 'cif', priority: 'lg' },
  { key: 'createdAt', priority: 'lg', sort: 'createdAt' },
]

export const DEFAULT_COLUMNS: ColumnKey[] = ['owner', 'status', 'nextTask', 'score', 'contact', 'note']

export const CALC_FNS: CalcFn[] = ['count', 'sum', 'avg', 'min', 'max']

const BY_KEY = new Map(COLUMN_DEFS.map((def) => [def.key, def]))

export const columnDef = (key: ColumnKey): ColumnDef => BY_KEY.get(key)!

export const isColumnKey = (key: string): key is ColumnKey => BY_KEY.has(key as ColumnKey)

/** Saved keys → known, unique ones in saved order; nothing usable (a new view, an old key) → the defaults. */
export function resolveColumns(saved: readonly string[] | null | undefined): ColumnKey[] {
  const keys = [...new Set((saved ?? []).filter(isColumnKey))]
  return keys.length > 0 ? keys : [...DEFAULT_COLUMNS]
}

/** Hiding the last visible column would bring the defaults back on the next load, so it is refused. */
export function toggleColumn(columns: ColumnKey[], key: ColumnKey): ColumnKey[] {
  if (columns.includes(key)) return columns.length > 1 ? columns.filter((entry) => entry !== key) : columns
  return [...columns, key]
}

export function moveColumn(columns: ColumnKey[], from: ColumnKey, to: ColumnKey): ColumnKey[] {
  const fromIndex = columns.indexOf(from)
  const toIndex = columns.indexOf(to)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return columns
  const next = columns.filter((entry) => entry !== from)
  next.splice(toIndex, 0, from)
  return next
}

export const sameColumns = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, i) => key === b[i])

/** The calcs that still have a visible numeric column under them. */
export function visibleCalcs(columns: ColumnKey[], calcs: Record<string, CalcFn>): Array<[ColumnKey, CalcFn]> {
  return columns.flatMap((key) => {
    const fn = calcs[key]
    return fn && columnDef(key).calc ? [[key, fn] as [ColumnKey, CalcFn]] : []
  })
}
