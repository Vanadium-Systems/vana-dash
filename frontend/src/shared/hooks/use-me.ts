import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { api } from '@/shared/lib/api'
import type { FeatureKey, SessionPayload } from '@/shared/lib/types'

// Cine e omul logat și ce poate face (PLAN.md C2, FE-2). Un singur query, același pe
// toate paginile (`['auth','me']`), ca lista de funcționalități să nu difere între două
// ecrane: nav, Ctrl K, tab-uri și butoane citesc toate de aici. Serverul e singurul care
// decide (guard-ul de pe rute), `can()` e doar ca ascundem ce nu se poate face.

export const ME_QUERY_KEY = ['auth', 'me'] as const

export interface UseMe {
  session: SessionPayload | null
  features: Set<FeatureKey>
  /**
   * `null`/ lipsa = pagină fără funcționalitate proprie (ex. Echipă), deci mereu adevărat.
   * Cât timp sesiunea e necunoscută (`/me` nu a răspuns, sau suntem offline) nu ascundem
   * nimic: autoritatea e guard-ul de pe server, iar un ecran gol din cauza rețelei ar fi
   * mai rău decât un 403 la prima cerere.
   */
  can: (feature: FeatureKey | null | undefined) => boolean
  canAny: (list: FeatureKey[]) => boolean
  isPending: boolean
  isError: boolean
  error: Error | null
}

export function useMe(): UseMe {
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<SessionPayload>('/api/auth/me'),
    staleTime: 5 * 60 * 1000,
  })

  const session = query.data ?? null
  const features = useMemo(() => new Set(session?.features ?? []), [session])
  const can = useCallback(
    (feature: FeatureKey | null | undefined) => (feature === null || feature === undefined || session === null ? true : features.has(feature)),
    [features, session],
  )
  const canAny = useCallback((list: FeatureKey[]) => (session === null ? true : list.some((f) => features.has(f))), [features, session])

  return {
    session,
    features,
    can,
    canAny,
    isPending: query.isPending,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  }
}
