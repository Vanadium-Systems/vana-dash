import { useQuery, type QueryKey } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'

/**
 * A query for totals. `data` is what `useQuery` would give; `money` says which currency the
 * server computed the figures in, so the screen never assumes one.
 */
export function useMoneyQuery<T>(queryKey: QueryKey, path: string, options?: { enabled?: boolean; staleTime?: number }) {
  const query = useQuery({ queryKey, queryFn: () => api.getWithMoney<T>(path), ...options })
  return { ...query, data: query.data?.data, money: query.data?.money }
}
