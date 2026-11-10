import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'

export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  readAt: string | null
  createdAt: string
}

interface NotificationPage {
  rows: AppNotification[]
  nextCursor: string | null
  unread: number
}

const KEY = ['notifications'] as const
const POLL_MS = 60_000

/** There is no push channel to the page for these, so the bell polls; focus brings a fresh list at once. */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: KEY,
    queryFn: ({ pageParam }) => api.get<NotificationPage>(`/api/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  })
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids: string[] } | { all: true }) => api.post('/api/notifications/read', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
