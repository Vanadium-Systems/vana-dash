import type { FilterClause } from '@/shared/lib/filters'

export type ProspectKind = 'companies' | 'people'
export type ProspectPriority = 'HOT' | 'WARM' | 'NURTURE' | 'SKIP'
export type SortKey = 'score' | 'name' | 'updatedAt' | 'createdAt' | 'lastActivityAt' | 'value' | 'expectedCloseAt' | 'daysInStage' | 'nextTask'
export type SortDir = 'asc' | 'desc'
export type CalcFn = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type CalcField = 'score' | 'value' | 'employees' | 'revenue'

export interface SortState {
  key: SortKey
  dir: SortDir
}

export interface NextTask {
  id: string
  kind: string
  title: string
  dueAt: string
  assigneeUserId: string
  assigneeName: string | null
}

/** One row of `GET /api/prospects` for `kind=companies` (service.ts `rowColumns`). Numerics come as strings. */
export interface ProspectRow {
  id: string
  name: string
  cif: string | null
  website: string | null
  caenCode: string | null
  employeeCount: number | null
  revenue: string | null
  score: string | null
  priority: ProspectPriority
  status: string
  daysInStage: number
  source: string | null
  billingClientId: string | null
  valueAmount: string | null
  valueCurrency: string | null
  expectedCloseAt: string | null
  assignedUserId: string | null
  ownerName: string | null
  lastActivityAt: string | null
  createdAt: string
  archivedAt: string | null
  canEdit: boolean
  primaryPhone: string | null
  primaryEmail: string | null
  primaryPerson: string | null
  note: { id: string; body: string } | null
  nextTask: NextTask | null
}

/** One row for `kind=people`: the person with the company they belong to. */
export interface PersonRow {
  id: string
  name: string
  role: string | null
  isDecisionMaker: boolean
  doNotContact: boolean
  prospectId: string
  prospectName: string
  status: string
  score: string | null
  priority: ProspectPriority
  assignedUserId: string | null
  ownerName: string | null
  phone: string | null
  email: string | null
  canEdit: boolean
}

export interface ListResponse<Row> {
  rows: Row[]
  total: number
  page: number
  pageSize: number
}

export interface AggregateResult {
  value: number | null
  byCurrency?: Array<{ currency: string | null; amount: number | null }>
}

export interface ProspectView {
  id: string
  name: string
  kind: ProspectKind
  q: string
  filters: FilterClause[]
  columns: string[]
  sort: SortState | null
  calcs: Record<string, CalcFn>
  layout: 'list' | 'board' | 'forecast'
  shared: boolean
  notifyNew: boolean
  ownerId: string
  ownerName: string
  isMine: boolean
  starred: boolean
}

export interface ViewsResponse {
  mine: ProspectView[]
  starred: ProspectView[]
  shared: ProspectView[]
}

export interface ProspectList {
  id: string
  name: string
  memberCount: number
  isMine: boolean
}
