import { useQuery } from '@tanstack/react-query'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { EmailUnreadCounts } from '@/shared/lib/types'

// Poll la 15s — Cloudflare Email Routing ingerează în timp real pe backend, dar frontend-ul
// n-are push (websocket/SSE ar fi bloat pt. un singur utilizator); polling simplu ajunge ca
// Stefan să vadă mesaje noi fără refresh manual. Refolosit din AppLayout (badge nav) și
// EmailSidebar (badge Inbox/Spam) — un singur query, cache comun (React Query).
//
// `refetchOnWindowFocus` suprascrie explicit default-ul global (main.tsx: refetchOnWindowFocus:
// false, ca să nu enerveze pe restul dashboard-ului) — AICI chiar vrem update imediat când
// Stefan revine pe tab (badge-ul altfel părea "înghețat" până dădea click în pagina de email).
// Fără poll de fundal (2026-08-27) — tab-ul inactiv nu mai bate backend-ul la 15s; focus-ul
// recuperează instant orice a ratat.
export function useEmailUnreadCounts() {
  // Găsit live 2026-08-18: fără `enabled`, poll-ul continua la 15s cu sesiunea expirată —
  // 401 după 401, fără să se oprească vreodată singur (AppLayout rămâne montat cât timp
  // query-ul de auth n-a fost el însuși refăcut, vezi staleTime din useAuth).
  const { can } = useMe()
  return useQuery({
    queryKey: ['email', 'unread-counts'],
    queryFn: () => api.get<EmailUnreadCounts>('/api/email/unread-counts'),
    enabled: can('email.view'),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
}
