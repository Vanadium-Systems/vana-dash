import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import type { PaymentMethod, RecordDetail, RecordsPage, RecordTab } from '@/shared/lib/types'

export interface RecordsParams {
  direction: 'in' | 'out'
  tab: RecordTab
  q: string
  from: string | null
  to: string | null
  /** 1-based, like the server. */
  page: number
  pageSize: number
}

export const recordsKey = (params: RecordsParams) => ['accounting', 'records', 'page', params] as const
export const INVOICING_CLIENTS_KEY = ['invoicing', 'clients', 'picker'] as const
export const recordDetailKey = (id: string) => ['accounting', 'records', 'detail', id] as const

function recordsPath(params: RecordsParams): string {
  const query = new URLSearchParams({ direction: params.direction, tab: params.tab, page: String(params.page), pageSize: String(params.pageSize) })
  if (params.q) query.set('q', params.q)
  // Days of the company, taken as UTC bounds: an invoice stamped within a few hours of midnight can land on the neighbouring day.
  if (params.from) query.set('from', `${params.from}T00:00:00.000Z`)
  if (params.to) query.set('to', `${params.to}T23:59:59.999Z`)
  return `/api/accounting/records?${query}`
}

export function recordsQueryOptions(params: RecordsParams) {
  return { queryKey: recordsKey(params), queryFn: () => api.get<RecordsPage>(recordsPath(params)) }
}

export function useRecordsPage(params: RecordsParams) {
  return useQuery({ ...recordsQueryOptions(params), placeholderData: keepPreviousData })
}

export function useRecordDetail(id: string) {
  return useQuery({ queryKey: recordDetailKey(id), queryFn: () => api.get<RecordDetail>(`/api/accounting/records/${id}/detail`) })
}

/** Every list, page, detail and the reconciliation counters: a payment or a state change moves all of them. */
export function useInvalidateRecords() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['accounting'] })
    void queryClient.invalidateQueries({ queryKey: ['reconciliation'] })
  }
}

export interface PaymentInput {
  amount: number
  paidAt: string
  method: PaymentMethod
  reference?: string
  note?: string
}

// Issued invoices go through the invoicing routes, received documents through the accounting ones.
const paymentsBase = (direction: 'in' | 'out', recordId: string) =>
  direction === 'out' ? `/api/invoicing/invoices/${recordId}/payments` : `/api/accounting/records/${recordId}/payments`

export function useAddPayment(direction: 'in' | 'out', recordId: string) {
  const invalidate = useInvalidateRecords()
  return useMutation({
    mutationFn: (input: PaymentInput) => api.post<unknown>(paymentsBase(direction, recordId), input),
    onSuccess: invalidate,
  })
}

export function useRemovePayment(direction: 'in' | 'out', recordId: string) {
  const invalidate = useInvalidateRecords()
  return useMutation({
    mutationFn: (paymentId: string) => api.delete<unknown>(`${paymentsBase(direction, recordId)}/${paymentId}`),
    onSuccess: invalidate,
  })
}
