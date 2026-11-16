import { useQuery } from '@tanstack/react-query'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'

export interface Deadline {
  kind: 'invoice_due' | 'declaration' | 'anaf_token'
  /** Composed from data (document number · counterparty, `D301 2026-10`, a CIF); the label comes from `kind`. */
  title: string
  dueAt: string
  ref: { type: string; id: string } | null
  overdue: boolean
}

/** Upcoming and overdue deadlines from Invoices; the server leaves out what the person may not see. */
export function useDeadlines() {
  const { can } = useMe()
  return useQuery({
    queryKey: ['accounting', 'deadlines'],
    queryFn: () => api.get<{ items: Deadline[] }>('/api/accounting/deadlines'),
    enabled: can('facturi.view'),
    staleTime: 60_000,
  })
}

export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000)
}
