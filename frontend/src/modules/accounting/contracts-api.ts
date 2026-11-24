import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'

export const CONTRACT_STATUSES = ['draft', 'to_sign', 'signed', 'expired', 'terminated'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]
export const COUNTERPARTY_KINDS = ['client', 'prospect', 'user', 'other'] as const
export type CounterpartyKind = (typeof COUNTERPARTY_KINDS)[number]
export type ContractOrigin = 'saas' | 'template' | 'uploaded'

export interface RegistryRow {
  id: string
  title: string
  category: string
  counterpartyName: string
  counterpartyKind: CounterpartyKind
  number: string | null
  externalNumber: string | null
  status: ContractStatus
  signedOn: string | null
  startsOn: string | null
  endsOn: string | null
  /** yyyy-mm-dd */
  noticeDeadline: string | null
  origin: ContractOrigin
  ownerName: string | null
  latestDocument: { id: string; isSigned: boolean } | null
}

export interface RegistryDocument {
  id: string
  docType: 'contract' | 'anexa' | 'act_aditional' | 'document'
  isSigned: boolean
  signedAt: string | null
  createdAt: string
  sourceDocumentId: string | null
}

export interface RegistryHistoryItem {
  id: string
  at: string
  action: string
  actor: { id: string; name: string | null } | null
  viaToken: { id: string; name: string } | null
  changes: Record<string, [unknown, unknown]> | null
}

export interface RegistryContract {
  id: string
  title: string
  category: string
  counterpartyKind: CounterpartyKind
  billingClientId: string | null
  prospectId: string | null
  userId: string | null
  counterpartyName: string
  seriesId: string | null
  number: number | null
  externalNumber: string | null
  signedOn: string | null
  startsOn: string | null
  endsOn: string | null
  autoRenew: boolean
  renewalMonths: number | null
  noticeDays: number | null
  ownerUserId: string
  status: ContractStatus
  origin: ContractOrigin
  templateId: string | null
  fieldValues: Record<string, string | number | null> | null
  numberLabel: string | null
  noticeDeadline: string | null
  ownerName: string | null
  documents: RegistryDocument[]
  history: RegistryHistoryItem[]
}

export interface ContractSeries {
  id: string
  code: string
  name: string
  numberFormat: string
}

export interface NumberItem {
  number: number
  label: string
  kind: 'used' | 'reserved' | 'free'
  reservationId?: string
  note?: string | null
  contractId?: string
  counterpartyName?: string
  date?: string | null
  contractStatus?: ContractStatus
}

export interface NumbersList {
  series: ContractSeries | null
  next: number
  nextLabel?: string
  items: NumberItem[]
}

export interface TemplateField {
  key: string
  label: { ro: string; en: string }
  type: 'text' | 'number' | 'date' | 'money' | 'list' | 'party'
  required: boolean
  default?: string
  options?: string[]
}

export interface CustomTemplate {
  id: string
  name: string
  category: string
  isSystem?: boolean
  fields: TemplateField[]
  seriesId: string | null
}

export type Counterparty = { kind: 'client' | 'prospect' | 'user'; id: string; label: string } | { kind: 'other'; name: string }

export function counterpartyBody(party: Counterparty): { kind: 'client' | 'prospect' | 'user'; id: string } | { kind: 'other'; name: string } {
  return party.kind === 'other' ? { kind: 'other', name: party.name.trim() } : { kind: party.kind, id: party.id }
}

export function useContractNumbers(seriesId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['contracts', 'numbers', seriesId ?? 'default'],
    queryFn: () => api.get<NumbersList>(`/api/contracts/numbers${seriesId ? `?seriesId=${seriesId}` : ''}`),
    enabled,
  })
}

export function useContractSeries(enabled = true) {
  return useQuery({ queryKey: ['contracts', 'series'], queryFn: () => api.get<ContractSeries[]>('/api/contracts/series'), enabled })
}

/** The categories already in use, for the suggestions of a free-text field. */
export function useContractCategories(enabled = true) {
  return useQuery({
    queryKey: ['contracts', 'registry', 'categories'],
    queryFn: async () => {
      const { items } = await api.get<{ items: Array<Pick<RegistryRow, 'category'>> }>('/api/contracts/registry?pageSize=50')
      return [...new Set(items.map((row) => row.category))].sort((a, b) => a.localeCompare(b))
    },
    enabled,
  })
}

export function useCustomTemplates() {
  return useQuery({
    queryKey: ['contracts', 'templates', 'custom'],
    queryFn: async () => (await api.get<CustomTemplate[]>('/api/contracts/templates')).filter((template) => !template.isSystem),
  })
}
