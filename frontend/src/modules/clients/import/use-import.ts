import { useMutation } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
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
  researchFines: 'clients:import.fills.researchFines',
  researchNews: 'clients:import.fills.researchNews',
  researchBadNews: 'clients:import.fills.researchBadNews',
  researchGrowth: 'clients:import.fills.researchGrowth',
  researchCompetitor: 'clients:import.fills.researchCompetitor',
  researchCompetitorName: 'clients:import.fills.researchCompetitorName',
  phone: 'clients:import.fills.phone',
  email: 'clients:import.fills.email',
  contactName: 'clients:import.fills.contactName',
}

export const labelOf = (texts: Record<string, TKey>, code: string) => (texts[code] ? t(texts[code]) : code)
