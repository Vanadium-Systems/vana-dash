import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'

export interface SessionDevice {
  familyId: string
  deviceLabel: string | null
  ip: string | null
  createdAt: string
  lastUsedAt: string
  current: boolean
}

const DEVICES_KEY = ['me', 'sessions'] as const

export function useDevices() {
  return useQuery({ queryKey: DEVICES_KEY, queryFn: () => api.get<SessionDevice[]>('/api/me/sessions') })
}

function useDeviceMutation<TInput>(mutationFn: (input: TInput) => Promise<unknown>, doneMessage: () => string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEVICES_KEY })
      toast.success(doneMessage())
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('auth:devices.failed')),
  })
}

export function useLogoutDevice() {
  return useDeviceMutation((familyId: string) => api.delete(`/api/me/sessions/${familyId}`), () => t('auth:devices.logoutDone'))
}

export function useLogoutOtherDevices() {
  return useDeviceMutation(() => api.post('/api/me/sessions/revoke-others'), () => t('auth:devices.logoutOthersDone'))
}
