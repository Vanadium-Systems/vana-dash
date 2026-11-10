import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import type { Snippet, TaskCounts, TaskPage, TaskScope, TaskTabKey } from './types'

// Every key sits under `['prospects']`, so the sheet's `useWrite` refreshes the task page and the session too.
export function useTaskList({ tab, scope, page, pageSize, enabled = true }: { tab: TaskTabKey; scope: TaskScope; page: number; pageSize: number; enabled?: boolean }) {
  const query = new URLSearchParams({ tab, scope, page: String(page + 1), pageSize: String(pageSize) }).toString()
  return useQuery({
    queryKey: ['prospects', 'task-page', query],
    queryFn: () => api.get<TaskPage>(`/api/prospects/tasks?${query}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useTaskCounts(scope: TaskScope) {
  return useQuery({
    queryKey: ['prospects', 'task-counts', scope],
    queryFn: () => api.get<TaskCounts>(`/api/prospects/tasks/counts?scope=${scope}`),
    placeholderData: keepPreviousData,
  })
}

export function useSnippets() {
  return useQuery({ queryKey: ['snippets'], queryFn: () => api.get<Snippet[]>('/api/snippets'), staleTime: 5 * 60 * 1000 })
}
