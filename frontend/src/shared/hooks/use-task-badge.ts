import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import { useMe } from './use-me'

/** My tasks due today or already late, for the Clients nav item. Shares its key with the Tasks tab, so a write refreshes both. */
export function useTaskBadge(): number | undefined {
  const { can } = useMe()
  const query = useQuery({
    queryKey: ['prospects', 'task-counts', 'mine'],
    queryFn: () => api.get<{ today: number; overdue: number }>('/api/prospects/tasks/counts?scope=mine'),
    enabled: can('clienti.view'),
    refetchInterval: 5 * 60_000,
    select: (counts) => counts.today + counts.overdue,
  })
  return query.data
}
