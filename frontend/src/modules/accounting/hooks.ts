import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import type {
  FinancialRecord,
  MonthCloseSummary,
  RecurringExpense,
  ReverseChargeType,
  SupplierEmailRule,
} from '@/shared/lib/types'

export const monthCloseKey = (month: string) => ['accounting', 'month-close', month] as const
export const supplierRulesKey = ['accounting', 'supplier-rules'] as const

export function useMonthClose(month: string) {
  return useQuery({
    queryKey: monthCloseKey(month),
    queryFn: () =>
      api.get<MonthCloseSummary>(
        `/api/accounting/month-close?month=${encodeURIComponent(month)}`,
      ),
    enabled: /^\d{4}-\d{2}$/.test(month),
  })
}

export function useArchiveMissingMonth() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { month: string }) =>
      api.post<{ archivedCount: number; failedCount?: number }>(
        '/api/accounting/month-close/archive-missing',
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'records'] })
    },
  })
}

export interface FulfillExpectedInput {
  month: string
  recurringExpenseId?: string | null
  supplierRuleId?: string | null
  counterpartyName?: string | null
  counterpartyCif?: string | null
  counterpartyCountry?: string | null
  reverseChargeType?: ReverseChargeType
  reverseChargeVatRate?: number | null
  documentNumber?: string | null
  issuedAt: string
  amount: number
  currency: 'RON' | 'EUR' | 'USD'
  category?: string | null
  filename: string
  contentBase64: string
}

export function useFulfillExpectedRow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: FulfillExpectedInput) =>
      api.post<FinancialRecord>('/api/accounting/month-close/fulfill-expected', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'records'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
    },
  })
}

export function useSetMonthClosureStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { month: string; closed: boolean; note?: string | null }) =>
      api.put<{ closed: boolean; closedAt: string | null }>(
        '/api/accounting/month-close/status',
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
    },
  })
}

export interface ConfirmRecordReviewInput {
  id: string
  documentNumber?: string | null
  issuedAt?: string
  amount?: number
  currency?: 'RON' | 'EUR' | 'USD'
  counterpartyName?: string
  counterpartyCif?: string | null
  counterpartyCountry?: string | null
  reverseChargeType?: ReverseChargeType
  reverseChargeVatRate?: number | null
}

export function useConfirmRecordReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ConfirmRecordReviewInput) =>
      api.post<FinancialRecord>(`/api/accounting/records/${id}/confirm-review`, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'records'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'record', variables.id] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'declarations'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
    },
  })
}

export interface UploadRecordPdfInput {
  id: string
  filename: string
  contentBase64: string
}

export function useUploadRecordPdf() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UploadRecordPdfInput) =>
      api.post<{ archiveFileId: string | null }>(`/api/accounting/records/${id}/upload-pdf`, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'records'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'record', variables.id] })
    },
  })
}

export function useArchiveRecord() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ archiveFileId: string | null }>(`/api/accounting/records/${id}/archive`, {}),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'records'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'record', id] })
    },
  })
}

export function useSupplierRules(enabled = true) {
  return useQuery({
    queryKey: supplierRulesKey,
    queryFn: () => api.get<SupplierEmailRule[]>('/api/accounting/supplier-rules'),
    enabled,
  })
}

export function useRecurringExpensesList(enabled = true) {
  return useQuery({
    queryKey: ['accounting', 'recurring-expenses'],
    queryFn: () => api.get<RecurringExpense[]>('/api/accounting/recurring-expenses'),
    enabled,
  })
}

export interface SupplierRulePayload {
  senderPattern: string
  subjectContains?: string | null
  attachmentNamePattern?: string | null
  counterpartyName: string
  counterpartyCif?: string | null
  counterpartyCountry?: string | null
  currency: 'RON' | 'EUR' | 'USD'
  category?: string | null
  reverseChargeType: ReverseChargeType
  reverseChargeVatRate?: number | null
  recurringExpenseId?: string | null
  active?: boolean
}

export function useCreateSupplierRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SupplierRulePayload) =>
      api.post<SupplierEmailRule>('/api/accounting/supplier-rules', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supplierRulesKey })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
    },
  })
}

export function useUpdateSupplierRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SupplierRulePayload> & { id: string }) =>
      api.patch<SupplierEmailRule>(`/api/accounting/supplier-rules/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supplierRulesKey })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
    },
  })
}

export function useDeleteSupplierRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/accounting/supplier-rules/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supplierRulesKey })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
    },
  })
}

export function useBackfillSupplierRules() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { months: number; ruleId?: string }) =>
      api.post<{
        scannedMessages: number
        createdRecords: number
        linkedRecurring: number
        skippedExisting: number
      }>('/api/accounting/supplier-rules/backfill', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'month-close'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'records'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
    },
  })
}

export async function downloadMonthPackageZip(month: string): Promise<void> {
  await api.download(
    `/api/accounting/month-close/package.zip?month=${encodeURIComponent(month)}`,
    `luna-${month}.zip`,
  )
}
