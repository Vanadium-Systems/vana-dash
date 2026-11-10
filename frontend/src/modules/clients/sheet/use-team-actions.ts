import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { useWrite } from './use-sheet'

/** The team routes of one prospect (claim, release, transfer, requests, collaborators); each reports its own outcome. */
export function useTeamActions(prospectId: string) {
  const write = useWrite()
  return {
    claim: () => write(() => api.post(`/api/prospects/${prospectId}/claim`), t('clients:sheet.team.claimed')),
    release: () => write(() => api.post(`/api/prospects/${prospectId}/release`), t('clients:sheet.team.released')),
    transfer: async (toUserId: string, note: string) => {
      const result = await write(() => api.post<{ transferred: number; skipped: unknown[] }>('/api/prospects/transfer', { ids: [prospectId], toUserId, ...(note.trim() ? { note: note.trim() } : {}) }))
      if (!result) return false
      if (result.transferred === 0) {
        toast.error(t('clients:prospects.bulk.skipped', { count: result.skipped.length }))
        return false
      }
      toast.success(t('clients:sheet.team.transferred'))
      return true
    },
    request: async (kind: 'transfer' | 'access', note: string) =>
      (await write(() => api.post(`/api/prospects/${prospectId}/transfer-requests`, { kind, ...(note.trim() ? { note: note.trim() } : {}) }), t('clients:sheet.team.requestSent'))) !== undefined,
    decide: (requestId: string, action: 'accept' | 'refuse' | 'cancel') =>
      write(() => api.patch(`/api/prospects/transfer-requests/${requestId}`, { action }), t(action === 'accept' ? 'clients:sheet.team.requestAccepted' : action === 'refuse' ? 'clients:sheet.team.requestRefused' : 'clients:sheet.team.requestCancelled')),
    setCollaborator: (userId: string, level: 'view' | 'edit') => write(() => api.put(`/api/prospects/${prospectId}/collaborators/${userId}`, { level })),
    removeCollaborator: (userId: string) => write(() => api.delete(`/api/prospects/${prospectId}/collaborators/${userId}`)),
  }
}
