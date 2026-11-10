export type ImportAction = 'new' | 'update' | 'skip' | 'error'

export interface PreviewRow {
  line: number
  action: ImportAction
  name: string
  prospectId?: string
  ownerName?: string
  fills: string[]
  error?: string
  reason?: string
}

export interface ImportPreview {
  token: string
  counts: Record<ImportAction, number>
  rows: PreviewRow[]
}

export type DistributionMode = 'me' | 'user' | 'round_robin'

export interface Distribution {
  mode: DistributionMode
  userIds?: string[]
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: Array<{ line: number; code: string }>
}

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024
export const IMPORT_MAX_ROWS = 5000
export const IMPORT_EXTENSIONS = ['.xlsx', '.csv']
