export interface HealthCounts {
  withoutPhone: number
  withoutEmail: number
  invalidOrBounced: number
  struckOff: number
  duplicates: number
  lastCheckedAt: string | null
}

export type DuplicateReason = 'cif' | 'phone' | 'email' | 'name'

export interface DuplicatePart {
  id: string
  name: string
  cif: string | null
  ownerName: string | null
  status: string
  createdAt: string
  people: number
  contactPoints: number
  notes: number
  openTasks: number
}

export interface DuplicatePair {
  a: DuplicatePart
  b: DuplicatePart
  reasons: DuplicateReason[]
  canMerge: boolean
}

export interface DuplicatesPage {
  items: DuplicatePair[]
  total: number
  page: number
  pageSize: number
  checkedAt: string | null
}

export const MERGE_FIELDS = [
  'name',
  'cif',
  'website',
  'caenCode',
  'foundingYear',
  'employeeCount',
  'revenue',
  'profit',
  'debt',
  'equity',
  'cash',
  'receivables',
  'inventory',
  'valueAmount',
  'valueCurrency',
  'expectedCloseAt',
  'source',
  'isActive',
  'status',
  'assignedUserId',
] as const
export type MergeField = (typeof MERGE_FIELDS)[number]
export type Side = 'master' | 'other'

export interface MergeFieldRow {
  field: MergeField
  master: string | number | boolean | null
  other: string | number | boolean | null
  proposed: Side
}

export interface MergeMoves {
  people: number
  contactPoints: number
  notes: number
  tasks: number
  listMemberships: number
  enrollments: number
  stageEvents: number
  collaborators: number
  calls: number
}

export interface MergePreview {
  fields: MergeFieldRow[]
  moves: MergeMoves
}
