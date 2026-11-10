import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { serializeClauses, type FilterClause } from '@/shared/lib/filters'
import type { AddMembersResult, ListEntry, ListFolder, SkipRules } from './types'

export function useListFolders() {
  return useQuery({ queryKey: ['prospects', 'list-folders'], queryFn: () => api.get<ListFolder[]>('/api/prospects/list-folders') })
}

/** Same key as the selection bar's lists: one request feeds the menu, the filter chip and the Liste tab. */
export function useLists() {
  return useQuery({ queryKey: ['prospects', 'lists'], queryFn: () => api.get<ListEntry[]>('/api/prospects/lists') })
}

/** The filter that shows only the members of a list: what "opening" a list means. */
export const listFilter = (listId: string): FilterClause[] => [{ field: 'list', op: 'in', value: [listId] }]
export const listFilterParam = (listId: string) => serializeClauses(listFilter(listId))

export function useListActions() {
  const queryClient = useQueryClient()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['prospects'] })
  const onError = (err: Error) => toast.error(err.message)

  const createFolder = useMutation({
    mutationFn: (body: { name: string; shared: boolean }) => api.post<ListFolder>('/api/prospects/list-folders', body),
    onSuccess: refresh,
    onError,
  })
  const updateFolder = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<{ name: string; shared: boolean }> }) => api.patch<ListFolder>(`/api/prospects/list-folders/${id}`, body),
    onSuccess: refresh,
    onError,
  })
  const deleteFolder = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/prospects/list-folders/${id}`),
    onSuccess: refresh,
    onError,
  })

  const createList = useMutation({
    mutationFn: (body: { name: string; folderId: string | null; shared: boolean }) => api.post<ListEntry>('/api/prospects/lists', body),
    onSuccess: refresh,
    onError,
  })
  const updateList = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<{ name: string; folderId: string | null; shared: boolean }> }) => api.patch<ListEntry>(`/api/prospects/lists/${id}`, body),
    onSuccess: refresh,
    onError,
  })
  const deleteList = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/prospects/lists/${id}`),
    onSuccess: refresh,
    onError,
  })

  const addFromSearch = useMutation({
    mutationFn: ({ listId, f, q, rules, limit }: { listId: string; f: FilterClause[]; q: string; rules: SkipRules; limit?: number }) =>
      api.post<AddMembersResult>(`/api/prospects/lists/${listId}/members`, { f, ...(q ? { q } : {}), rules, ...(limit ? { limit } : {}) }),
    onSuccess: refresh,
  })

  const addByIds = useMutation({
    mutationFn: ({ listId, ids }: { listId: string; ids: string[] }) => api.post<AddMembersResult>(`/api/prospects/lists/${listId}/members`, { ids }),
    onSuccess: refresh,
    onError,
  })

  return { createFolder, updateFolder, deleteFolder, createList, updateList, deleteList, addFromSearch, addByIds }
}
