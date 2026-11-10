import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import { serializeClauses, type FilterClause } from '@/shared/lib/filters'
import type { ProspectAssignee } from '@/shared/lib/types'
import type { ListResponse, PersonRow, ProspectKind, ProspectList, ProspectRow, SortState, ViewsResponse } from './types'
import type { ProspectStatusEntry } from '@/shared/lib/types'

export function filterParams(f: FilterClause[], q: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra)
  if (q) params.set('q', q)
  if (f.length) params.set('f', serializeClauses(f))
  return params.toString()
}

export function useStatuses() {
  return useQuery({ queryKey: ['prospects', 'statuses'], queryFn: () => api.get<ProspectStatusEntry[]>('/api/prospects/statuses') })
}

export function useAssignees() {
  return useQuery({ queryKey: ['prospects', 'assignees'], queryFn: () => api.get<ProspectAssignee[]>('/api/prospects/assignees'), staleTime: 5 * 60 * 1000 })
}

export function useViews() {
  return useQuery({ queryKey: ['prospects', 'views'], queryFn: () => api.get<ViewsResponse>('/api/prospects/views') })
}

export function useProspectLists(enabled: boolean) {
  return useQuery({ queryKey: ['prospects', 'lists'], queryFn: () => api.get<ProspectList[]>('/api/prospects/lists'), enabled })
}

interface ListArgs {
  f: FilterClause[]
  q: string
  kind: ProspectKind
  sort: SortState | null
  page: number
  pageSize: number
}

/** A page of the list from the server; the previous page stays on screen while the next one loads. */
export function useProspectList<Row extends ProspectRow | PersonRow>({ f, q, kind, sort, page, pageSize }: ListArgs) {
  const extra: Record<string, string> = { kind, page: String(page + 1), pageSize: String(pageSize) }
  if (sort && kind === 'companies') {
    extra.sort = sort.key
    extra.dir = sort.dir
  }
  const query = filterParams(f, q, extra)
  return useQuery({
    queryKey: ['prospects', 'list', query],
    queryFn: () => api.get<ListResponse<Row>>(`/api/prospects?${query}`),
    placeholderData: keepPreviousData,
  })
}

/** The live number for a tab; `null` is the server giving up after its time budget. */
export function useKindCount(kind: ProspectKind, f: FilterClause[], q: string) {
  return useQuery({
    queryKey: ['prospects', 'count', kind, filterParams(f, q)],
    queryFn: () => api.get<{ total: number | null }>(`/api/prospects/count?${filterParams(f, q, { kind })}`).then((r) => r.total),
    placeholderData: keepPreviousData,
  })
}
