import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { CallFilter, CallRow, PublicCall } from './types'

export const CALLS_KEY = ['calls'] as const

export const CALL_FILTERS: CallFilter[] = ['all', 'open', 'ended']

export function useCalls(status: CallFilter) {
  return useQuery({
    queryKey: [...CALLS_KEY, status],
    queryFn: () => api.get<CallRow[]>(`/api/calls?status=${status}`),
  })
}

export function useCreateCall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; expiresInHours: number }) => api.post<CallRow>('/api/calls', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CALLS_KEY }),
  })
}

/** Asks first; resolves to true only when the call was ended. */
export function useEndCall() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const end = useMutation({
    mutationFn: (id: string) => api.post<CallRow>(`/api/calls/${id}/end`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CALLS_KEY }),
    onError: (err: Error) => toast.error(err.message),
  })
  return async (call: Pick<CallRow, 'id' | 'title'>): Promise<boolean> => {
    const ok = await confirm({
      title: t('calls:endConfirm.title', { title: call.title }),
      consequence: t('calls:endConfirm.body'),
      confirmLabel: t('calls:endConfirm.action'),
      destructive: true,
    })
    if (!ok) return false
    await end.mutateAsync(call.id)
    return true
  }
}

// The owner token is single-use per page visit; refetching would mint a new one mid-call.
export function useJoinCall(id: string) {
  return useQuery({
    queryKey: [...CALLS_KEY, 'join', id],
    queryFn: () => api.post<{ roomUrl: string; token: string }>(`/api/calls/${id}/join`),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export function usePublicCall(publicId: string) {
  return useQuery({
    queryKey: ['public-call', publicId],
    queryFn: () => api.get<PublicCall>(`/api/public/calls/${publicId}`),
    retry: false,
  })
}

export async function copyCallLink(call: Pick<CallRow, 'publicUrl'>): Promise<void> {
  await navigator.clipboard.writeText(call.publicUrl)
  toast.success(t('calls:copied'))
}
