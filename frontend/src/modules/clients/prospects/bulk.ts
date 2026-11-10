import type { FilterClause } from '@/shared/lib/filters'

/** Picked rows, or "all N that match": the second one sends the filters, so rows past the page are included. */
export type BulkTarget = { mode: 'ids'; ids: string[] } | { mode: 'matching'; f: FilterClause[]; q: string }

export function bulkTarget(args: { ids: string[]; allMatching: boolean; f: FilterClause[]; q: string }): BulkTarget {
  return args.allMatching ? { mode: 'matching', f: args.f, q: args.q } : { mode: 'ids', ids: args.ids }
}

export type BulkAction = 'status' | 'archive' | 'unarchive'

/** Body of `PATCH /api/prospects/bulk`. */
export function bulkPatchBody(target: BulkTarget, action: BulkAction, extra: { value?: string; lostReason?: string } = {}) {
  const base = { action, ...(extra.value ? { value: extra.value } : {}), ...(extra.lostReason ? { lostReason: extra.lostReason } : {}) }
  if (target.mode === 'ids') return { ...base, ids: target.ids }
  return { ...base, all: true, f: target.f, ...(target.q ? { q: target.q } : {}) }
}

/** Body of `POST /api/prospects/lists/:id/members`: ids, or the search itself. */
export function listMembersBody(target: BulkTarget) {
  if (target.mode === 'ids') return { ids: target.ids }
  return { f: target.f, ...(target.q ? { q: target.q } : {}) }
}

export const targetCount = (target: BulkTarget, total: number) => (target.mode === 'ids' ? target.ids.length : total)
