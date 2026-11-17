import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { toastError } from '@/shared/lib/errors'

export interface SessionDevice {
  familyId: string
  deviceLabel: string | null
  ip: string | null
  createdAt: string
  lastUsedAt: string
  current: boolean
}

const DEVICES_KEY = ['me', 'sessions'] as const

/**
 * The message keys of each login (PLAN.md part M), by session family. Signed = the device can
 * read; the fingerprint is the start of its signing key, the same on every screen that shows it.
 */
export function useMessageKeys() {
  const { can } = useMe()
  return useQuery({
    queryKey: ['chat', 'keys', 'me'],
    enabled: can('mesaje.view'),
    queryFn: async () => {
      const keys = await api.get<{ devices: { sessionFamilyId: string | null; signingKey: string; masterSignature: string | null }[] }>(
        '/api/chat/keys/me',
      )
      return new Map(
        keys.devices
          .filter((device) => device.sessionFamilyId)
          .map((device) => [
            device.sessionFamilyId!,
            { approved: device.masterSignature !== null, fingerprint: device.signingKey.slice(0, 12).match(/.{4}/g)!.join(' ') },
          ]),
      )
    },
  })
}

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
    onError: (error) => toastError(error, t('auth:devices.failed')),
  })
}

export function useLogoutDevice() {
  return useDeviceMutation((familyId: string) => api.delete(`/api/me/sessions/${familyId}`), () => t('auth:devices.logoutDone'))
}

export function useLogoutOtherDevices() {
  return useDeviceMutation(() => api.post('/api/me/sessions/revoke-others'), () => t('auth:devices.logoutOthersDone'))
}
