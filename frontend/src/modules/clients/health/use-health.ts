import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import type { DuplicatesPage, HealthCounts, MergeField, MergePreview, Side } from './types'

export function useHealth() {
  return useQuery({ queryKey: ['prospects', 'health'], queryFn: () => api.get<HealthCounts>('/api/prospects/health') })
}

export function useDuplicates(page: number, pageSize: number) {
  return useQuery({
    queryKey: ['prospects', 'health', 'duplicates', page, pageSize],
    queryFn: () => api.get<DuplicatesPage>(`/api/prospects/health/duplicates?page=${page + 1}&pageSize=${pageSize}`),
    placeholderData: keepPreviousData,
  })
}

export function useMergePreview(masterId: string, otherId: string) {
  return useQuery({
    queryKey: ['prospects', 'merge-preview', masterId, otherId],
    queryFn: () => api.get<MergePreview>(`/api/prospects/merge/preview?masterId=${masterId}&otherId=${otherId}`),
    retry: false,
  })
}

export function useMerge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { masterId: string; otherId: string; fields: Partial<Record<MergeField, Side>> }) => api.post<{ id?: string }>('/api/prospects/merge', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  })
}
