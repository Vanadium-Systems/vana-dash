import { getLocale, t } from './i18n'
import { INTL_TAG } from './locale'

// All number, money and date formatting, in the language of the interface. Dates are shown in
// Bucharest time whatever the language: the company's day does not move with the reader.

export const TIME_ZONE = 'Europe/Bucharest'

/** The BCP 47 tag of the current language, for the one-off `Intl` call a helper here does not cover. */
export function intlTag(): string {
  return INTL_TAG[getLocale()]
}

type DateInput = string | number | Date
const toDate = (value: DateInput): Date => (value instanceof Date ? value : new Date(value))

export function formatNumber(value: number, unit?: string | null): string {
  const formatted = new Intl.NumberFormat(intlTag(), { maximumFractionDigits: 2 }).format(value)
  if (unit === 'RON' || unit === 'EUR' || unit === 'USD') return `${formatted} ${unit}`
  if (unit === 'kg') return `${formatted} kg`
  if (unit === '%') return `${formatted}%`
  return formatted
}

/**
 * An amount with its currency. The currency always comes from the data (a document keeps its
 * own, a total says which one the server computed it in); nothing here assumes RON.
 */
export function formatMoney(amount: number | string, currency: string, options?: { decimals?: number }): string {
  const decimals = options?.decimals ?? 2
  const formatted = new Intl.NumberFormat(intlTag(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(amount))
  return `${formatted} ${currency}`
}

export function formatDate(value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(intlTag(), { timeZone: TIME_ZONE, ...options }).format(toDate(value))
}

export function formatDateTime(value: DateInput): string {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * "2 hours ago", "3 days ago", then the full date past a week, so two screens do not each
 * write their own format.
 */
export function formatRelativeTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value)
  const relative = new Intl.RelativeTimeFormat(intlTag(), { numeric: 'auto' })
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000)
  const past = Math.abs(minutes)
  if (past < 1) return t('common:time.justNow')
  if (past < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 8) return relative.format(days, 'day')
  return formatDateTime(date)
}
