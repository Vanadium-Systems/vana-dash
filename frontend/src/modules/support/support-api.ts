import { useQuery } from '@tanstack/react-query'
import type { StateTone } from '@/shared/components/ui/state-pill'
import { api } from '@/shared/lib/api'
import { useMe } from '@/shared/hooks/use-me'
import type { SupportTicketStatus } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// Aceleași ecrane servesc două priviri: tichetele mele (`mine`) și toate tichetele, pentru
// contul de platformă (`platform`). Diferă doar prefixul de API și cel de rută.
export type SupportScope = 'mine' | 'platform'

export const SUPPORT_PATHS: Record<SupportScope, { api: string; route: string }> = {
  mine: { api: '/api/support/tickets', route: '/support' },
  platform: { api: '/api/platform/support/tickets', route: '/platform/support' },
}

export const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  deschis: t('support:status.open'),
  raspuns: t('support:status.answered'),
  inchis: t('support:status.closed'),
}

export const STATUS_TONE: Record<SupportTicketStatus, StateTone> = {
  deschis: 'warning',
  raspuns: 'success',
  inchis: 'neutral',
}

export const SUPPORT_UNREAD_KEY = ['support', 'unread'] as const

/** Tichete cu răspuns necitit (`mine`) și tichete care așteaptă platforma (`platform`, null fără drept). */
export function useSupportUnread() {
  const { session } = useMe()
  return useQuery({
    queryKey: SUPPORT_UNREAD_KEY,
    queryFn: () => api.get<{ mine: number; platform: number | null }>('/api/support/unread'),
    enabled: session !== null,
    refetchInterval: 5 * 60 * 1000,
  })
}
