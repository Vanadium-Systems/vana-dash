import { describe, expect, it } from 'vitest'
import type { FilterClause } from '@/shared/lib/filters'
import { bulkPatchBody, bulkTarget, listMembersBody, targetCount } from './bulk'

const f: FilterClause[] = [{ field: 'status', op: 'in', value: ['new'] }]

describe('bulk payload', () => {
  it('sends ids when the picked rows are the target', () => {
    const target = bulkTarget({ ids: ['a', 'b'], allMatching: false, f, q: 'acme' })
    expect(bulkPatchBody(target, 'archive')).toEqual({ action: 'archive', ids: ['a', 'b'] })
    expect(targetCount(target, 412)).toBe(2)
  })

  it('sends the filters and the search, no ids, for "all N matching"', () => {
    const target = bulkTarget({ ids: ['a', 'b'], allMatching: true, f, q: 'acme' })
    const body = bulkPatchBody(target, 'status', { value: 'won' })
    expect(body).toEqual({ action: 'status', value: 'won', all: true, f, q: 'acme' })
    expect(body).not.toHaveProperty('ids')
    expect(targetCount(target, 412)).toBe(412)
  })

  it('leaves out an empty search and an unset lost reason', () => {
    const body = bulkPatchBody(bulkTarget({ ids: [], allMatching: true, f: [], q: '' }), 'unarchive')
    expect(body).toEqual({ action: 'unarchive', all: true, f: [] })
  })

  it('builds the list-members body the same way', () => {
    expect(listMembersBody({ mode: 'ids', ids: ['a'] })).toEqual({ ids: ['a'] })
    expect(listMembersBody({ mode: 'matching', f, q: '' })).toEqual({ f })
  })
})
