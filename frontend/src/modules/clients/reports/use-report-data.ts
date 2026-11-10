import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'

export interface FunnelStage {
  status: string
  label: string
  reached: number
  /** 0..1 against the stage before; null for the first stage and when nobody reached the one before. */
  conversionFromPrevious: number | null
}

export interface AgentStats {
  userId: string
  name: string
  claimed: number
  contactedToday: number
  withoutNextStep: number
  won: number
}

export function useFunnel(from: string, to: string) {
  return useQuery({ queryKey: ['prospects', 'funnel', from, to], queryFn: () => api.get<{ stages: FunnelStage[] }>(`/api/prospects/funnel?from=${from}&to=${to}`) })
}

export function useAgentStats(from: string, to: string) {
  return useQuery({ queryKey: ['prospects', 'stats', 'by-agent', from, to], queryFn: () => api.get<AgentStats[]>(`/api/prospects/stats/by-agent?from=${from}&to=${to}`) })
}
