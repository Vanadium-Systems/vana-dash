import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { skippedSummary } from '../lists/skipped'
import type { AddMembersResult } from '../lists/types'
import type { BulkTarget } from './bulk'
import { bulkPatchBody, listMembersBody, type BulkAction } from './bulk'

export const LOST_REASON_REQUIRED = 'LOST_REASON_REQUIRED'

/** Prospect errors carry their code at the top of the body, next to `error`. */
export const errorCode = (err: unknown): string | undefined => (err instanceof ApiError ? err.code : undefined)

export function useProspectActions() {
  const queryClient = useQueryClient()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['prospects'] })
  const onError = (err: Error) => toast.error(err.message)

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/api/prospects/${id}`, body),
    onSuccess: refresh,
    onError,
  })

  const transfer = useMutation({
    mutationFn: ({ ids, toUserId }: { ids: string[]; toUserId: string }) => api.post<{ transferred: number; skipped: Array<{ id: string }> }>('/api/prospects/transfer', { ids, toUserId }),
    onSuccess: (data) => {
      refresh()
      if (data.transferred > 0) toast.success(t('clients:prospects.bulk.transferred', { count: data.transferred }))
      if (data.skipped.length > 0) toast.error(t('clients:prospects.bulk.skipped', { count: data.skipped.length }))
    },
    onError,
  })

  const bulk = useMutation({
    mutationFn: ({ target, action, value, lostReason }: { target: BulkTarget; action: BulkAction; value?: string; lostReason?: string }) =>
      api.patch<{ updated: number; skipped: Array<{ id: string }> }>('/api/prospects/bulk', bulkPatchBody(target, action, { value, lostReason })),
    onSuccess: (data) => {
      refresh()
      toast.success(t('clients:prospects.bulk.updated', { count: data.updated }))
      if (data.skipped.length > 0) toast.error(t('clients:prospects.bulk.skipped', { count: data.skipped.length }))
    },
    // A "lost" status asks for a reason: the page catches that code itself and asks the person.
    onError: (err) => {
      if (errorCode(err) !== LOST_REASON_REQUIRED) onError(err)
    },
  })

  const addToList = useMutation({
    mutationFn: ({ listId, target }: { listId: string; target: BulkTarget }) =>
      api.post<AddMembersResult>(`/api/prospects/lists/${listId}/members`, listMembersBody(target)),
    onSuccess: (data) => {
      refresh()
      const skipped = skippedSummary(data.skipped)
      toast.success(t('clients:prospects.bulk.listAdded', { count: data.added }) + (skipped ? ` ${skipped}` : ''))
    },
    onError,
  })

  const remove = useMutation({
    // One request per id: there is no bulk delete, and a page holds at most 50 rows.
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.delete<void>(`/api/prospects/${id}`)
      return ids.length
    },
    onSuccess: (count) => {
      refresh()
      toast.success(t('clients:prospects.bulk.deleted', { count }))
    },
    onError: (err) => {
      refresh()
      onError(err)
    },
  })

  return { patch, transfer, bulk, addToList, remove, refresh }
}
