import type { ProspectRow } from '../prospects/types'

export interface MoneySum {
  currency: string
  amount: number
}

export interface BoardColumnData {
  status: string
  label: string
  kind: 'open' | 'won' | 'lost'
  count: number
  sums: MoneySum[]
  /** null when the company currency has no rate feed; the per-currency sums still hold. */
  sumInCompanyCurrency: number | null
  cards: ProspectRow[]
}

export interface BoardResponse {
  columns: BoardColumnData[]
}

export interface ForecastBucket {
  count: number
  sums: MoneySum[]
}

export interface ForecastResponse {
  months: Array<ForecastBucket & { month: string }>
  undated: ForecastBucket
}
