import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { toastError } from '@/shared/lib/errors'

export interface ApiTokenItem {
  id: string
  name: string
  prefix: string
  /** `null` = everything the role has. */
  features: string[] | null
  expiresAt: string | null
  lastUsedAt: string | null
  lastUsedIp: string | null
  revokedAt: string | null
  createdAt: string
}

export interface AdminApiTokenItem extends ApiTokenItem {
  user: { id: string; displayName: string | null; email: string }
}

export interface CreateApiTokenInput {
  name: string
  features?: string[]
  expiresInDays: 30 | 90 | 365 | null
}

export const MY_TOKENS_KEY = ['api-tokens', 'me'] as const
export const ADMIN_TOKENS_KEY = ['api-tokens', 'admin'] as const

export function useMyApiTokens() {
  return useQuery({ queryKey: MY_TOKENS_KEY, queryFn: () => api.get<ApiTokenItem[]>('/api/me/api-tokens') })
}

export function useAdminApiTokens() {
  return useQuery({ queryKey: ADMIN_TOKENS_KEY, queryFn: () => api.get<AdminApiTokenItem[]>('/api/admin/api-tokens') })
}

export function useCreateApiToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateApiTokenInput) => api.post<{ token: string; item: ApiTokenItem }>('/api/me/api-tokens', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  })
}

/** `admin` = the company route (`echipa.administrare`), otherwise the person's own. */
export function useRevokeApiToken(admin: boolean) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(admin ? `/api/admin/api-tokens/${id}` : `/api/me/api-tokens/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      toast.success(t('auth:apiTokens.revokeDialog.done'))
    },
    onError: (error) => toastError(error, t('auth:apiTokens.revokeDialog.failed')),
  })
}

/** With the IP only in the row details: an IPv6 address would widen the table cell. */
export function lastUsedText(item: ApiTokenItem, withIp = false): string {
  if (!item.lastUsedAt) return t('auth:apiTokens.neverUsed')
  return withIp && item.lastUsedIp ? `${formatDateTime(item.lastUsedAt)} · ${item.lastUsedIp}` : formatDateTime(item.lastUsedAt)
}

export function expiresText(item: ApiTokenItem): string {
  if (item.revokedAt) return t('auth:apiTokens.revoked')
  return item.expiresAt ? formatDate(item.expiresAt) : t('auth:apiTokens.neverExpires')
}

export function featuresText(item: ApiTokenItem): string {
  return item.features === null ? t('auth:apiTokens.allOfRole') : t('auth:apiTokens.featuresCount', { count: item.features.length })
}

/** The prefix is all that is shown again; the ellipsis says the rest is missing. */
export function prefixText(item: ApiTokenItem): string {
  return `${item.prefix}\u2026`
}
