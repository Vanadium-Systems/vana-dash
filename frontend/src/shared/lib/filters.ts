import { formatDate, formatNumber } from './format'
import { t } from './i18n'

// The filter clauses a list sends to the server as `?f=` (same shape as the backend's compact JSON).

export interface FilterField {
  key: string
  label: string
  type: 'enum' | 'date' | 'number' | 'text'
  options?: Array<{ value: string; label: string }>
  /** Heading in "Toate filtrele". */
  group?: string
  /** Shown in the bar until the person unpins it. */
  defaultPinned?: boolean
  /** Hides the "is not" switch, for fields whose values are not a plain list (archived: yes / any). */
  noNegate?: boolean
  /** Restricts the modes the editor offers, for fields the server only answers for some of them (phone: empty / filled). */
  ops?: Array<'in' | 'not_in' | 'between' | 'is_empty' | 'not_empty'>
}

export type FilterClause =
  | { field: string; op: 'in' | 'not_in'; value: string[] }
  | { field: string; op: 'between'; value: [string | number | null, string | number | null] }
  | { field: string; op: 'is_empty' | 'not_empty' }

export const MAX_CLAUSES = 40
export const MAX_FILTER_CHARS = 8000

function isScalar(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

function isClause(raw: unknown): raw is FilterClause {
  if (!raw || typeof raw !== 'object') return false
  const clause = raw as { field?: unknown; op?: unknown; value?: unknown }
  if (typeof clause.field !== 'string' || !clause.field) return false
  if (clause.op === 'in' || clause.op === 'not_in') return Array.isArray(clause.value) && clause.value.length > 0 && clause.value.every((v) => typeof v === 'string')
  if (clause.op === 'between') return Array.isArray(clause.value) && clause.value.length === 2 && clause.value.every(isScalar)
  return clause.op === 'is_empty' || clause.op === 'not_empty'
}

/** Bad or oversized input is an empty filter, never an exception: the value comes from a URL anyone can edit. */
export function parseClauses(raw: string | null | undefined): FilterClause[] {
  if (!raw || raw.length > MAX_FILTER_CHARS) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > MAX_CLAUSES || !parsed.every(isClause)) return []
    return parsed
  } catch {
    return []
  }
}

export function serializeClauses(clauses: FilterClause[]): string {
  return clauses.length ? JSON.stringify(clauses) : ''
}

/** Replaces the clause at `index`, removes it for `null`, appends when `index` is -1. */
export function replaceClause(clauses: FilterClause[], index: number, next: FilterClause | null): FilterClause[] {
  if (index < 0) return next ? [...clauses, next] : clauses
  if (!next) return clauses.filter((_, i) => i !== index)
  return clauses.map((clause, i) => (i === index ? next : clause))
}

// A date `to` bound is the end of that day, otherwise the server (which compares timestamps) leaves the day out.
const END_OF_DAY = 'T23:59:59'
export function dateBoundsToClause(field: string, [from, to]: [string | null, string | null]): FilterClause | null {
  if (!from && !to) return null
  return { field, op: 'between', value: [from, to ? `${to}${END_OF_DAY}` : null] }
}
export const dayOf = (value: string | number | null): string | null => (typeof value === 'string' && value ? value.slice(0, 10) : null)

function formatBound(field: FilterField, value: string | number | null): string {
  if (field.type === 'date') {
    const day = dayOf(value)
    // Noon keeps the day stable in any zone.
    return day ? formatDate(`${day}T12:00:00`) : ''
  }
  return typeof value === 'number' ? formatNumber(value) : String(value ?? '')
}

export function clauseValueLabel(field: FilterField, clause: FilterClause): string {
  if (!('value' in clause)) return t(clause.op === 'is_empty' ? 'common:filterBar.isEmpty' : 'common:filterBar.notEmpty')
  if (clause.op === 'between') {
    const [from, to] = clause.value
    if (from !== null && from !== '' && to !== null && to !== '') return t('common:filterBar.range', { from: formatBound(field, from), to: formatBound(field, to) })
    if (from !== null && from !== '') return t('common:filterBar.rangeFrom', { from: formatBound(field, from) })
    return t('common:filterBar.rangeTo', { to: formatBound(field, to) })
  }
  const labels = clause.value.map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(', ')
  return clause.op === 'not_in' ? t('common:filterBar.notValue', { values: labels }) : labels
}

/** "Status: Contactat, Interesat" / "Status: nu Pierdut" / "Ultima activitate: gol". */
export function clauseLabel(field: FilterField, clause: FilterClause): string {
  return t('common:filterBar.chip', { field: field.label, value: clauseValueLabel(field, clause) })
}

/** "1.204 de rezultate"; `null` is the server giving up on counting (over its budget). */
export function resultsLabel(count: number | null): string {
  if (count === null) return t('common:filterBar.resultsOver', { n: formatNumber(1000) })
  return t('common:filterBar.results', { count, n: formatNumber(count) })
}
