import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'

export type WidgetSize = 's' | 'w' | 'l' | 'band'

export interface HomeLayoutItem {
  widget: string
  size: WidgetSize
  order: number
  options?: Record<string, unknown>
}

export interface HomeLayout {
  layout: HomeLayoutItem[]
  source: 'user' | 'company' | 'default'
}

const LAYOUT_KEY = ['dashboard', 'layout'] as const

/** The person's grid: their own, else the company's, else the default (decided by the server). */
export function useHomeLayout() {
  return useQuery({ queryKey: LAYOUT_KEY, queryFn: () => api.get<HomeLayout>('/api/dashboard/layout'), staleTime: 60_000 })
}

export function useSaveHomeLayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (layout: HomeLayoutItem[]) => api.put<HomeLayout>('/api/dashboard/layout', { layout }),
    onSuccess: (data) => queryClient.setQueryData(LAYOUT_KEY, data),
  })
}

export function useResetHomeLayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<HomeLayout>('/api/dashboard/layout'),
    onSuccess: (data) => queryClient.setQueryData(LAYOUT_KEY, data),
  })
}

/** The company's default grid, for whoever administers the team. */
export function useSaveCompanyLayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (layout: HomeLayoutItem[]) => api.put<HomeLayout>('/api/dashboard/layout/company', { layout }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: LAYOUT_KEY }),
  })
}
