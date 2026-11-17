import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { buildPublicCallUrl, getCallKey } from './call-keys'
import type { CallFilter, CallKind, CallRow, CallTokenResponse, PublicCall, PublicCallTokenResponse } from './types'

export const CALLS_KEY = ['calls'] as const

export const CALL_FILTERS: CallFilter[] = ['all', 'open', 'ended']

export function useCalls(status: CallFilter, enabled = true) {
  return useQuery({
    queryKey: [...CALLS_KEY, status],
    queryFn: () => api.get<CallRow[]>(`/api/calls?status=${status}`),
    enabled,
  })
}

export function useCallsStatus(enabled = true) {
  return useQuery({
    queryKey: [...CALLS_KEY, 'status'],
    queryFn: () => api.get<{ configured: boolean }>('/api/calls/status'),
    enabled,
    staleTime: 60_000,
  })
}

export function useCreateCall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      title: string
      expiresInHours: number
      kind?: CallKind
      scheduledAt?: string
      prospectId?: string
      billingClientId?: string
      conversationId?: string
    }) => api.post<CallRow>('/api/calls', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CALLS_KEY }),
  })
}

/** Asks first; resolves to true only when the call was ended. */
export function useEndCall() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const end = useMutation({
    mutationFn: async ({ id, conversationId }: { id: string; conversationId?: string | null }): Promise<void> => {
      if (conversationId) {
        await api.post<void>(`/api/chat/calls/${id}/end`, {})
      } else {
        await api.post<CallRow>(`/api/calls/${id}/end`, {})
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CALLS_KEY }),
    onError: (err: Error) => toast.error(err.message),
  })
  return async (call: Pick<CallRow, 'id' | 'title'> & { conversationId?: string | null }): Promise<boolean> => {
    const ok = await confirm({
      title: t('calls:endConfirm.title', { title: call.title }),
      consequence: t('calls:endConfirm.body'),
      confirmLabel: t('calls:endConfirm.action'),
      destructive: true,
    })
    if (!ok) return false
    await end.mutateAsync({ id: call.id, conversationId: call.conversationId })
    return true
  }
}

// The room token is minted per page visit; refetching would rotate it mid-call.
export function useJoinCall(id: string) {
  return useQuery({
    queryKey: [...CALLS_KEY, 'token', id],
    queryFn: () => api.post<CallTokenResponse>(`/api/calls/${id}/token`, {}),
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

export function usePublicCallToken(publicId: string) {
  return useMutation({
    mutationFn: (guestName: string) =>
      api.post<PublicCallTokenResponse>(`/api/public/calls/${publicId}/token`, { guestName }),
  })
}

export async function copyCallLink(call: Pick<CallRow, 'id' | 'publicUrl'>, explicitKey?: string | null): Promise<void> {
  const key = explicitKey ?? getCallKey(call.id)
  await navigator.clipboard.writeText(buildPublicCallUrl(call.publicUrl, key))
  toast.success(t('calls:copied'))
}
