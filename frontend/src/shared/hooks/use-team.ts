import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import type { SessionRole } from '@/shared/lib/types'

// Membrii echipei (PLAN.md C2): lista e `self` — orice om activ o vede, ca să îi poată
// scrie cuiva din Mesaje. E singura sursă pentru Echipă, pentru numele adminului de pe
// pagina „Nu ai acces la …" și pentru „Trimis de …" din email, deci un singur query.

export interface TeamMember {
  id: string
  displayName: string | null
  email: string
  status: 'invited' | 'active' | 'disabled'
  lastSeenAt: string | null
  role: SessionRole | null
}

export const TEAM_QUERY_KEY = ['team', 'members'] as const

export function useTeamMembers() {
  return useQuery({
    queryKey: TEAM_QUERY_KEY,
    queryFn: () => api.get<TeamMember[]>('/api/team/members'),
    staleTime: 60 * 1000,
  })
}

export function memberName(member: Pick<TeamMember, 'displayName' | 'email'>): string {
  return member.displayName ?? member.email
}

/** Numele primului admin activ — cui îi ceri o funcționalitate lipsă. */
export function activeAdminName(members: TeamMember[] | undefined): string | null {
  const admin = members?.find((m) => m.role?.kind === 'admin' && m.status === 'active')
  return admin ? memberName(admin) : null
}

/** id → nume, pentru mesajele trimise pe o cutie comună („Trimis de Ana"). */
export function memberNameMap(members: TeamMember[] | undefined): Map<string, string> {
  return new Map((members ?? []).map((m) => [m.id, memberName(m)]))
}
