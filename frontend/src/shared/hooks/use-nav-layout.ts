import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import { useMe } from '@/shared/hooks/use-me'
import { resolveNavLayout, type NavItemDef } from '@/shared/lib/nav-items'

// Ordine + vizibilitate nav din dashboard_config['nav.layout'] (Contractul F). Lipsa
// config-ului = default canonic din cod. Invalidat de editorul din Setări (['nav-layout']).
//
// Paginile fără funcționalitatea lor nu intră deloc: un item ascuns în nav, dar deschizibil
// prin link, ar da un 403 la prima cerere (§5.17 — ascunzi ce nu poate face niciodată omul
// în rolul lui).

interface NavLayoutResponse {
  items: Array<{ to: string; visible: boolean }> | null
}

export function useNavLayout() {
  const { can } = useMe()
  const query = useQuery({
    queryKey: ['nav-layout'],
    queryFn: () => api.get<NavLayoutResponse>('/api/settings/nav-layout'),
    staleTime: 5 * 60 * 1000,
    // Nav-ul nu merită un fallback UI — până răspunde, default canonic e perfect.
    retry: 1,
  })
  const items: NavItemDef[] = resolveNavLayout(query.data?.items).filter((item) => can(item.feature))
  return { items, isLoading: query.isLoading }
}
