import type { RecordDetail } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'

export type PriceCurrency = 'EUR' | 'USD' | ''
export type DocumentKind = 'invoice' | 'proforma'

export interface LineDraft {
  description: string
  quantity: string
  /** As typed, in `priceCurrency`. '' = the document's own currency (no conversion). */
  price: string
  /** A foreign price is converted at the BNR rate on the issue date; what was typed is never overwritten. */
  priceCurrency: PriceCurrency
  vatRate: string
}

export interface EditorForm {
  billingClientId: string
  currency: string
  /** YYYY-MM-DD */
  issuedAt: string
  /** YYYY-MM-DD or '' */
  dueAt: string
  note: string
  lines: LineDraft[]
}

export type Rates = Partial<Record<'EUR' | 'USD', number>>

export const EMPTY_LINE: LineDraft = { description: '', quantity: '1', price: '', priceCurrency: '', vatRate: '0' }
export const DUE_PRESETS = [7, 15, 30, 60, 90] as const

/** The detail route also returns `updatedAt`; the shared type predates it. */
export type DraftRecord = RecordDetail['record'] & { updatedAt?: string }

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Half-up to whole cents; the epsilon keeps 1.005 from landing on 1.00. */
export function toCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100)
}

export interface ParsedLine {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
}

export interface LineAmounts {
  netCents: number
  vatCents: number
  grossCents: number
}

export type LineState =
  | { kind: 'ok'; line: ParsedLine; amounts: LineAmounts }
  | { kind: 'pending' }
  | { kind: 'incomplete' }

/** `pending` = a foreign price whose BNR rate has not arrived yet; the line must not be saved as 0. */
export function evaluateLine(line: LineDraft, currency: string, rates: Rates): LineState {
  const quantity = parseRoDecimal(line.quantity)
  const raw = parseRoDecimal(line.price)
  const vatRate = parseRoDecimal(line.vatRate)
  if (!line.description.trim() || !(quantity > 0) || !Number.isFinite(raw) || raw < 0 || !(vatRate >= 0 && vatRate <= 100)) {
    return { kind: 'incomplete' }
  }
  let unit = raw
  if (line.priceCurrency && line.priceCurrency !== currency) {
    const rate = rates[line.priceCurrency]
    if (rate === undefined) return { kind: 'pending' }
    unit = raw * rate
  }
  const unitPrice = round2(unit)
  const netCents = Math.round(quantity * toCents(unitPrice))
  const vatCents = Math.round((netCents * vatRate) / 100)
  return {
    kind: 'ok',
    line: { description: line.description.trim(), quantity, unitPrice, vatRate },
    amounts: { netCents, vatCents, grossCents: netCents + vatCents },
  }
}

export function evaluateLines(lines: LineDraft[], currency: string, rates: Rates): LineState[] {
  return lines.map((line) => evaluateLine(line, currency, rates))
}

export function totalsOf(states: LineState[]): LineAmounts {
  const total = { netCents: 0, vatCents: 0, grossCents: 0 }
  for (const state of states) {
    if (state.kind !== 'ok') continue
    total.netCents += state.amounts.netCents
    total.vatCents += state.amounts.vatCents
    total.grossCents += state.amounts.grossCents
  }
  return total
}

export type Missing = 'client' | 'line' | 'rate'

/** What stops the draft from being saved and previewed; empty = valid. */
export function missingOf(form: EditorForm, states: LineState[], locked: boolean): Missing[] {
  if (locked) return form.issuedAt ? [] : ['line']
  const missing: Missing[] = []
  if (!form.billingClientId) missing.push('client')
  if (states.some((s) => s.kind === 'incomplete')) missing.push('line')
  else if (states.some((s) => s.kind === 'pending')) missing.push('rate')
  return missing
}

export interface DraftPayload {
  billingClientId?: string
  currency?: string
  issuedAt?: string
  dueAt?: string
  note: string
  lines?: ParsedLine[]
}

/** A storno draft keeps its lines, client and currency (the server answers 400 STORNO_LOCKED otherwise). */
export function buildPayload(form: EditorForm, states: LineState[], locked: boolean): DraftPayload {
  const dates = { issuedAt: form.issuedAt || undefined, dueAt: form.dueAt || undefined, note: form.note }
  if (locked) return dates
  return {
    billingClientId: form.billingClientId,
    currency: form.currency,
    ...dates,
    lines: states.flatMap((s) => (s.kind === 'ok' ? [s.line] : [])),
  }
}

const DAY_MS = 86_400_000
const parseDay = (day: string) => Date.parse(`${day}T00:00:00Z`)

export function addDays(day: string, days: number): string {
  return new Date(parseDay(day) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS)
}

/** A preset when the due date is exactly N days after issue, 'custom' for any other date, null when unset. */
export function duePresetOf(issuedAt: string, dueAt: string): number | 'custom' | null {
  if (!dueAt) return null
  const days = daysBetween(issuedAt, dueAt)
  return (DUE_PRESETS as readonly number[]).includes(days) ? days : 'custom'
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
}

export const emptyForm = (currency: string, issuedAt: string): EditorForm => ({
  billingClientId: '',
  currency,
  issuedAt,
  dueAt: '',
  note: '',
  lines: [{ ...EMPTY_LINE }],
})

export function formFromDetail(data: RecordDetail): EditorForm {
  const { record } = data
  return {
    billingClientId: record.billingClientId ?? '',
    currency: record.currency,
    issuedAt: record.issuedAt.slice(0, 10),
    dueAt: record.dueAt ? record.dueAt.slice(0, 10) : '',
    note: record.description ?? '',
    lines: data.lines.length
      ? data.lines.map((l) => ({
          description: l.description,
          quantity: String(Number(l.quantity)),
          price: String(Number(l.unitPrice)),
          priceCurrency: '' as const,
          vatRate: String(Number(l.vatRate)),
        }))
      : [{ ...EMPTY_LINE }],
  }
}
