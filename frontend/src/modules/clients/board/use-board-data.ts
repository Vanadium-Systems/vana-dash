import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import type { FilterClause } from '@/shared/lib/filters'
import { filterParams } from '../prospects/use-prospect-data'
import type { ProspectRow } from '../prospects/types'
import type { BoardResponse, ForecastResponse } from './types'

export function useBoard(f: FilterClause[], q: string, enabled: boolean) {
  const query = filterParams(f, q)
  return useQuery({ queryKey: ['prospects', 'board', query], queryFn: () => api.get<BoardResponse>(`/api/prospects/board?${query}`), enabled })
}

export function useForecast(f: FilterClause[], q: string, enabled: boolean) {
  const query = filterParams(f, q)
  return useQuery({ queryKey: ['prospects', 'forecast', query], queryFn: () => api.get<ForecastResponse>(`/api/prospects/forecast?${query}`), enabled })
}

export function fetchBoardColumn(f: FilterClause[], q: string, status: string, page: number) {
  return api.get<{ cards: ProspectRow[]; total: number }>(`/api/prospects/board/column?${filterParams(f, q, { status, page: String(page) })}`)
}

/**
 * Moves a card between columns. The card changes column at once and goes back if the server refuses;
 * the sums come from the refetch, not from a guess.
 */
export function useMoveProspect(f: FilterClause[], q: string) {
  const queryClient = useQueryClient()
  const boardKey = ['prospects', 'board', filterParams(f, q)]
  return useMutation({
    mutationFn: ({ id, status, lostReason }: { id: string; status: string; lostReason?: string }) =>
      api.patch(`/api/prospects/${id}`, { status, ...(lostReason ? { lostReason } : {}) }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: boardKey })
      const before = queryClient.getQueryData<BoardResponse>(boardKey)
      if (before) {
        const card = before.columns.flatMap((col) => col.cards).find((c) => c.id === id)
        if (card) {
          queryClient.setQueryData<BoardResponse>(boardKey, {
            columns: before.columns.map((col) => {
              const without = col.cards.filter((c) => c.id !== id)
              return col.status === status ? { ...col, cards: [{ ...card, status, daysInStage: 0 }, ...without] } : { ...col, cards: without }
            }),
          })
        }
      }
      return { before }
    },
    onError: (err: Error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(boardKey, context.before)
      toast.error(err.message)
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  })
}
