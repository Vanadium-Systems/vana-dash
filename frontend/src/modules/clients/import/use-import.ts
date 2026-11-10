import { useMutation } from '@tanstack/react-query'
import { ApiError, api } from '@/shared/lib/api'
import { t, type TKey } from '@/shared/lib/i18n'
import type { Distribution, ImportPreview, ImportResult } from './types'

export function usePreviewImport() {
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('file', file)
      return api.upload<ImportPreview>('/api/prospects/import/preview', body)
    },
  })
}

export function useCommitImport() {
  return useMutation({
    mutationFn: (input: { token: string; distribution: Distribution }) => api.post<ImportResult>('/api/prospects/import/commit', input),
  })
}

const ERROR_TEXTS: Record<string, TKey> = {
  IMPORT_TOO_MANY_ROWS: 'clients:import.errors.IMPORT_TOO_MANY_ROWS',
  IMPORT_NO_NAME_COLUMN: 'clients:import.errors.IMPORT_NO_NAME_COLUMN',
  IMPORT_UNSUPPORTED_FILE: 'clients:import.errors.IMPORT_UNSUPPORTED_FILE',
  IMPORT_UNREADABLE: 'clients:import.errors.IMPORT_UNREADABLE',
  IMPORT_TOKEN_EXPIRED: 'clients:import.errors.IMPORT_TOKEN_EXPIRED',
  IMPORT_NEEDS_REASSIGN: 'clients:import.errors.IMPORT_NEEDS_REASSIGN',
}

/** The app's own text for the server's code, else the message the server sent. */
export function importErrorMessage(err: unknown): string {
  const key = err instanceof ApiError && err.code ? ERROR_TEXTS[err.code] : undefined
  if (key) return t(key)
  return err instanceof Error ? err.message : t('common:states.loadFailed')
}

export const ROW_ERROR_TEXTS: Record<string, TKey> = {
  MISSING_NAME: 'clients:import.rowErrors.MISSING_NAME',
  INVALID_CUI: 'clients:import.rowErrors.INVALID_CUI',
  DUPLICATE_IN_FILE: 'clients:import.rowErrors.DUPLICATE_IN_FILE',
}

export const FILL_TEXTS: Record<string, TKey> = {
  cif: 'clients:import.fills.cif',
  website: 'clients:import.fills.website',
  caenCode: 'clients:import.fills.caenCode',
  foundingYear: 'clients:import.fills.foundingYear',
  employeeCount: 'clients:import.fills.employeeCount',
  revenue: 'clients:import.fills.revenue',
  profit: 'clients:import.fills.profit',
  debt: 'clients:import.fills.debt',
  equity: 'clients:import.fills.equity',
  cash: 'clients:import.fills.cash',
  receivables: 'clients:import.fills.receivables',
  inventory: 'clients:import.fills.inventory',
  isActive: 'clients:import.fills.isActive',
  phone: 'clients:import.fills.phone',
  email: 'clients:import.fills.email',
  contactName: 'clients:import.fills.contactName',
}

export const labelOf = (texts: Record<string, TKey>, code: string) => (texts[code] ? t(texts[code]) : code)
