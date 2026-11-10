import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { filterParams } from '../prospects/use-prospect-data'
import type { ContactCheck, DiscussedIn, ListState, Neighbors, ProspectSheet, ReleaseSettings, SheetNote, SheetTask, TimelinePage } from './types'

const isNotFound = (err: unknown) => err instanceof ApiError && err.status === 404

/** Every sheet query lives under `['prospects']`, so one invalidation keeps the sheet and the list in step. */
export function useSheetRefresh() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['prospects'] })
}

export function useSheet(id: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['prospects', 'sheet', id],
    queryFn: () => api.get<ProspectSheet>(`/api/prospects/${id}`),
    retry: (count, err) => !isNotFound(err) && count < 2,
  })
}

export function useNeighbors(id: string, list: ListState | undefined) {
  const extra: Record<string, string> = list?.sort ? { sort: list.sort.key, dir: list.sort.dir } : {}
  const query = list ? filterParams(list.f, list.q, extra) : ''
  return useQuery({
    queryKey: ['prospects', 'neighbors', id, query],
    queryFn: () => api.get<Neighbors>(`/api/prospects/${id}/neighbors?${query}`),
    enabled: Boolean(list),
    placeholderData: keepPreviousData,
  })
}

export function useTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: ['prospects', 'timeline', id],
    queryFn: ({ pageParam }) => api.get<TimelinePage>(`/api/prospects/${id}/timeline${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useNotes(id: string) {
  return useQuery({ queryKey: ['prospects', 'notes', id], queryFn: () => api.get<SheetNote[]>(`/api/prospects/${id}/notes`) })
}

export function useTasks(id: string) {
  return useQuery({ queryKey: ['prospects', 'tasks', id], queryFn: () => api.get<SheetTask[]>(`/api/prospects/${id}/tasks`) })
}

export function useContactCheck(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['prospects', 'contact-check', id], queryFn: () => api.get<ContactCheck>(`/api/prospects/${id}/contact-check`), enabled, staleTime: 0 })
}

export function useDiscussedIn(id: string) {
  return useQuery({ queryKey: ['prospects', 'discussed', id], queryFn: () => api.get<DiscussedIn[]>(`/api/chat/refs?type=prospect&id=${id}`) })
}

export function useReleaseSettings() {
  return useQuery({ queryKey: ['prospects', 'release-settings'], queryFn: () => api.get<ReleaseSettings>('/api/prospects/release-settings'), staleTime: 5 * 60 * 1000 })
}

/** Runs a write, refreshes the prospect queries and says what went wrong; `undefined` means it failed. */
export function useWrite() {
  const refresh = useSheetRefresh()
  return async <T>(run: () => Promise<T>, done?: string): Promise<T | undefined> => {
    try {
      const result = await run()
      refresh()
      if (done) toast.success(done)
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:states.changeNotSaved'))
      return undefined
    }
  }
}

export { isNotFound }
