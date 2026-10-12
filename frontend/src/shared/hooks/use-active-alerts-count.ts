import { useQuery } from '@tanstack/react-query'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'

// Badge roșu în sidebar lângă "Alerte" — pattern identic use-email-unread-counts.ts (inclusiv
// gate-ul `enabled` pe funcționalitate, ca poll-ul să nu continue la nesfârșit după logout).
export function useActiveAlertsCount() {
  // Fără `alerte.view` nu e nici badge de alertat, nici interogare: un 403 la fiecare
  // minut ar însemna un ecran cu o eroare ascunsă în colțul lui.
  const { can } = useMe()
  return useQuery({
    queryKey: ['alerts', 'active-count'],
    queryFn: () => api.get<{ count: number }>('/api/alerts/active-count'),
    enabled: can('alerte.view'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}
