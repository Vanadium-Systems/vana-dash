// The event form only edits FREQ, INTERVAL and BYDAY. Every other part of a rule (COUNT, BYSETPOS,
// WKST...) is carried through untouched, and a rule the form cannot show (monthly, "first Monday")
// is kept verbatim, so opening and saving an event never rewrites its series.

import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

export const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthlyDate' | 'monthlyWeekday' | 'yearly' | 'custom'

export interface RecurrenceForm {
  type: RecurrenceType
  /** Every N days / weeks / months / years; 1 = every. */
  interval: number
  days: string[]
  /** Parts the form does not edit, as written in the rule. */
  rest: string[]
  /** The original rule, kept for `custom`. */
  raw: string | null
}

export const NO_RECURRENCE: RecurrenceForm = { type: 'none', interval: 1, days: [], rest: [], raw: null }

const WEEKDAYS = BYDAY_CODES.slice(0, 5)
// Besides these the shapes added later (monthly, yearly, weekdays) must not carry anything else,
// otherwise the form would rebuild them as a different rule.
const PLAIN_EXTRAS = ['COUNT', 'UNTIL', 'WKST']
const NTH_DAY = /^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/

function ruleParts(rule: string): Array<[string, string]> {
  return rule
    .replace(/^RRULE:/, '')
    .split(';')
    .filter(Boolean)
    .map((part) => {
      const [key = '', value = ''] = part.split('=')
      return [key, value]
    })
}

/** Which occurrence of its weekday a date is in the month: 1..4, or -1 in the last 7 days. */
function nthWeekdayOfMonth(date: Date): number {
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return date.getDate() > daysInMonth - 7 ? -1 : Math.ceil(date.getDate() / 7)
}

function weekdayCode(date: Date): string {
  return BYDAY_CODES[date.getDay() === 0 ? 6 : date.getDay() - 1] ?? 'MO'
}

/** `start` is optional: when given, a monthly rule that does not fall on the start stays `custom`. */
export function parseRecurrence(rule: string | null, start?: Date): RecurrenceForm {
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
  const extras = rest.filter((part) => !part.startsWith('BYMONTHDAY='))
  const plain = extras.every((part) => PLAIN_EXTRAS.includes(part.split('=')[0] ?? ''))
  const byMonthDay = rest.filter((part) => part.startsWith('BYMONTHDAY='))
  if (freq === 'DAILY' && days.length === 0) return { type: 'daily', interval, days: [], rest, raw: rule }
  if (freq === 'WEEKLY' && interval === 1 && plain && rest.length === extras.length && days.join() === WEEKDAYS.join()) {
    return { type: 'weekdays', interval: 1, days: [], rest: extras, raw: rule }
  }
  // "1MO" (first Monday) and the like are not plain weekdays: the form cannot show them.
  if (freq === 'WEEKLY' && days.every((day) => BYDAY_CODES.includes(day))) return { type: 'weekly', interval, days, rest, raw: rule }
  if (freq === 'MONTHLY' && plain && days.length === 0 && byMonthDay.length === 1) {
    const day = Number(byMonthDay[0]?.split('=')[1])
    if (Number.isInteger(day) && day >= 1 && day <= 31 && (!start || start.getDate() === day)) {
      return { type: 'monthlyDate', interval, days: [], rest: extras, raw: rule }
    }
  }
  if (freq === 'MONTHLY' && plain && byMonthDay.length === 0 && days.length === 1) {
    const match = NTH_DAY.exec(days[0] ?? '')
    if (match && (!start || (Number(match[1]) === nthWeekdayOfMonth(start) && match[2] === weekdayCode(start)))) {
      return { type: 'monthlyWeekday', interval, days: [], rest: extras, raw: rule }
    }
  }
  if (freq === 'YEARLY' && plain && rest.length === extras.length && days.length === 0) {
    return { type: 'yearly', interval, days: [], rest: extras, raw: rule }
  }
  return custom
}

export function buildRecurrence(form: RecurrenceForm, start: Date): string | null {
  if (form.type === 'none') return null
  if (form.type === 'custom') return form.raw
  const freq = { daily: 'DAILY', weekly: 'WEEKLY', weekdays: 'WEEKLY', monthlyDate: 'MONTHLY', monthlyWeekday: 'MONTHLY', yearly: 'YEARLY' }[form.type]
  const parts = [`FREQ=${freq}`]
  if (form.interval > 1 && form.type !== 'weekdays') parts.push(`INTERVAL=${form.interval}`)
  if (form.type === 'weekly') {
    const days = form.days.length > 0 ? BYDAY_CODES.filter((code) => form.days.includes(code)) : [weekdayCode(start)]
    parts.push(`BYDAY=${days.join(',')}`)
  }
  if (form.type === 'weekdays') parts.push(`BYDAY=${WEEKDAYS.join(',')}`)
  if (form.type === 'monthlyDate') parts.push(`BYMONTHDAY=${start.getDate()}`)
  if (form.type === 'monthlyWeekday') parts.push(`BYDAY=${nthWeekdayOfMonth(start)}${weekdayCode(start)}`)
  return [...parts, ...form.rest].join(';')
}

const ORDINAL_KEYS = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last' } as const

function weekdayName(code: string): string {
  const index = Math.max(0, BYDAY_CODES.indexOf(code))
  // 2026-11-02 is a Monday.
  return new Intl.DateTimeFormat(intlTag(), { weekday: 'long' }).format(new Date(2026, 10, 2 + index))
}

function ruleEnd(value: string | undefined): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? '')
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

/** A one-line summary of a rule for the event form and the event details. */
export function describeRule(rule: string | null, start: Date, until: Date | null = null): string {
  if (!rule) return ''
  const form = parseRecurrence(rule)
  if (form.type === 'custom' || form.type === 'none') return t('calendar:recurrence.custom')
  const parts = new Map(ruleParts(rule))
  const count = form.interval
  const many = count > 1
  const list = new Intl.ListFormat(intlTag(), { style: 'long', type: 'conjunction' })
  let text: string
  switch (form.type) {
    case 'daily':
      text = many ? t('calendar:recurrence.everyDays', { count }) : t('calendar:recurrence.daily')
      break
    case 'weekdays':
      text = t('calendar:recurrence.weekdays')
      break
    case 'weekly': {
      const codes = form.days.length > 0 ? BYDAY_CODES.filter((code) => form.days.includes(code)) : [weekdayCode(start)]
      const days = list.format(codes.map(weekdayName))
      text = many ? t('calendar:recurrence.everyWeeks', { count, days }) : t('calendar:recurrence.weekly', { days })
      break
    }
    case 'monthlyDate': {
      const day = Number(parts.get('BYMONTHDAY'))
      text = many ? t('calendar:recurrence.everyMonthsDate', { count, day }) : t('calendar:recurrence.monthlyDate', { day })
      break
    }
    case 'monthlyWeekday': {
      const match = NTH_DAY.exec(parts.get('BYDAY') ?? '')
      const ordinal = t(`calendar:recurrence.ordinal.${ORDINAL_KEYS[(match?.[1] ?? '1') as keyof typeof ORDINAL_KEYS]}`)
      const weekday = weekdayName(match?.[2] ?? 'MO')
      text = many
        ? t('calendar:recurrence.everyMonthsWeekday', { count, ordinal, weekday })
        : t('calendar:recurrence.monthlyWeekday', { ordinal, weekday })
      break
    }
    default: {
      const date = new Intl.DateTimeFormat(intlTag(), { day: 'numeric', month: 'long' }).format(start)
      text = many ? t('calendar:recurrence.everyYears', { count, date }) : t('calendar:recurrence.yearly', { date })
    }
  }
  const end = until ?? ruleEnd(parts.get('UNTIL'))
  if (end) {
    const options: Intl.DateTimeFormatOptions =
      end.getFullYear() === start.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }
    text += t('calendar:recurrence.until', { date: new Intl.DateTimeFormat(intlTag(), options).format(end) })
  } else if (parts.has('COUNT')) {
    text += t('calendar:recurrence.times', { count: Number(parts.get('COUNT')) })
  }
  return text
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
