import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { ProspectView } from './types'
import { viewBody, type ViewSettings } from './view-state'

export interface NewViewInput {
  name: string
  shared: boolean
  notifyNew: boolean
}

export function useViewActions() {
  const queryClient = useQueryClient()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['prospects', 'views'] })
  const onError = (err: Error) => toast.error(err.message)

  const create = useMutation({
    mutationFn: ({ input, settings, layout = 'list' }: { input: NewViewInput; settings: ViewSettings; layout?: ProspectView['layout'] }) =>
      api.post<ProspectView>('/api/prospects/views', { ...input, ...viewBody(settings), layout }),
    onSuccess: refresh,
    onError,
  })

  const update = useMutation({
    mutationFn: ({ id, settings, layout }: { id: string; settings: ViewSettings; layout?: ProspectView['layout'] }) =>
      api.patch<ProspectView>(`/api/prospects/views/${id}`, { ...viewBody(settings), ...(layout ? { layout } : {}) }),
    onSuccess: () => {
      refresh()
      toast.success(t('clients:prospects.views.saved'))
    },
    onError,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/prospects/views/${id}`),
    onSuccess: refresh,
    onError,
  })

  const star = useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) => (starred ? api.put<void>(`/api/prospects/views/${id}/star`, {}) : api.delete<void>(`/api/prospects/views/${id}/star`)),
    onSuccess: refresh,
    onError,
  })

  return { create, update, remove, star }
}
