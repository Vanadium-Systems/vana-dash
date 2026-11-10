import { describe, expect, it } from 'vitest'
import { COLUMN_DEFS, DEFAULT_COLUMNS, columnDef, moveColumn, resolveColumns, toggleColumn, visibleCalcs } from './columns'

describe('column config', () => {
  it('gives every optional column a priority, so none can widen the table', () => {
    expect(COLUMN_DEFS.every((def) => def.priority === 'md' || def.priority === 'lg')).toBe(true)
  })

  it('has unique keys and only valid defaults', () => {
    const keys = COLUMN_DEFS.map((def) => def.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(DEFAULT_COLUMNS.every((key) => keys.includes(key))).toBe(true)
  })

  it('resolves unknown, repeated and missing keys', () => {
    expect(resolveColumns(['status', 'bogus', 'status', 'owner'])).toEqual(['status', 'owner'])
    expect(resolveColumns([])).toEqual(DEFAULT_COLUMNS)
    expect(resolveColumns(null)).toEqual(DEFAULT_COLUMNS)
  })

  it('moves a column to the place of another', () => {
    expect(moveColumn(['owner', 'status', 'score'], 'score', 'owner')).toEqual(['score', 'owner', 'status'])
    expect(moveColumn(['owner', 'status'], 'owner', 'score')).toEqual(['owner', 'status'])
  })

  it('refuses to hide the last visible column', () => {
    expect(toggleColumn(['status'], 'status')).toEqual(['status'])
    expect(toggleColumn(['status', 'owner'], 'status')).toEqual(['owner'])
    expect(toggleColumn(['status'], 'owner')).toEqual(['status', 'owner'])
  })

  it('keeps only calcs of visible numeric columns', () => {
    const calcs = { score: 'avg', value: 'sum', status: 'count' } as const
    expect(visibleCalcs(['score', 'status'], calcs)).toEqual([['score', 'avg']])
    expect(columnDef('value').calc).toBe('value')
  })
})
