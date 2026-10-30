// The event form only edits FREQ, INTERVAL and BYDAY. Every other part of a rule (COUNT, BYSETPOS,
// WKST...) is carried through untouched, and a rule the form cannot show (monthly, "first Monday")
// is kept verbatim, so opening and saving an event never rewrites its series.

export const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'custom'

export interface RecurrenceForm {
  type: RecurrenceType
  /** Every N days / weeks; 1 = every. */
  interval: number
  days: string[]
  /** Parts the form does not edit, as written in the rule. */
  rest: string[]
  /** The original rule, kept for `custom`. */
  raw: string | null
}

export const NO_RECURRENCE: RecurrenceForm = { type: 'none', interval: 1, days: [], rest: [], raw: null }

export function parseRecurrence(rule: string | null): RecurrenceForm {
  if (!rule) return NO_RECURRENCE
  const custom: RecurrenceForm = { ...NO_RECURRENCE, type: 'custom', raw: rule }
  let freq = ''
  let interval = 1
  let days: string[] = []
  const rest: string[] = []
  for (const part of rule.replace(/^RRULE:/, '').split(';').filter(Boolean)) {
    const [key, value = ''] = part.split('=')
    if (key === 'FREQ') freq = value
    else if (key === 'INTERVAL') interval = Math.max(1, Number(value) || 1)
    else if (key === 'BYDAY') days = value.split(',')
    else rest.push(part)
  }
  if (freq === 'DAILY' && days.length === 0) return { type: 'daily', interval, days: [], rest, raw: rule }
  // "1MO" (first Monday) and the like are not plain weekdays: the form cannot show them.
  if (freq === 'WEEKLY' && days.every((day) => BYDAY_CODES.includes(day))) return { type: 'weekly', interval, days, rest, raw: rule }
  return custom
}

export function buildRecurrence(form: RecurrenceForm, start: Date): string | null {
  if (form.type === 'none') return null
  if (form.type === 'custom') return form.raw
  const parts = [`FREQ=${form.type === 'daily' ? 'DAILY' : 'WEEKLY'}`]
  if (form.interval > 1) parts.push(`INTERVAL=${form.interval}`)
  if (form.type === 'weekly') {
    const startDay = BYDAY_CODES[start.getDay() === 0 ? 6 : start.getDay() - 1] ?? 'MO'
    const days = form.days.length > 0 ? BYDAY_CODES.filter((code) => form.days.includes(code)) : [startDay]
    parts.push(`BYDAY=${days.join(',')}`)
  }
  return [...parts, ...form.rest].join(';')
}

/** `recurrenceEndAt` as the value of a date input, in local time. */
export function recurrenceEndInputValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The end of the chosen local day, so the series still has its occurrence on that day. */
export function recurrenceEndIso(inputValue: string): string {
  const [year = 0, month = 1, day = 1] = inputValue.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}
