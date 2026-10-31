import { getLocale, t } from './i18n'
import { INTL_TAG } from './locale'

// All number, money and date formatting, in the language of the interface. Dates are shown in
// the company's time zone (its sheet, via /api/auth/me) whatever the language and wherever the
// reader is: the company's day does not move with the reader.

const TIME_ZONE_KEY = 'vana.companyTimeZone'

function rememberedTimeZone(): string {
  try {
    const saved = localStorage.getItem(TIME_ZONE_KEY)
    if (saved) return saved
  } catch {
    // No storage (private mode): the browser's zone until /me answers.
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

let companyZone = rememberedTimeZone()

/** Read at the moment of formatting, never into a module constant: /me may change it after load. */
export function companyTimeZone(): string {
  return companyZone
}

export function setCompanyTimeZone(timeZone: string): void {
  if (timeZone === companyZone) return
  companyZone = timeZone
  try {
    localStorage.setItem(TIME_ZONE_KEY, timeZone)
  } catch {
    // Kept for this tab only.
  }
}

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

/**
 * The same text as `formatMoney`, split so a screen can set the decimals apart: `whole` is the
 * sign and integer digits, `fraction` the decimal separator and decimals, `suffix` the
 * currency (with its leading space).
 */
export function formatMoneyParts(
  amount: number | string,
  currency: string,
  options?: { decimals?: number },
): { whole: string; fraction: string; suffix: string } {
  const decimals = options?.decimals ?? 2
  const parts = new Intl.NumberFormat(intlTag(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).formatToParts(Number(amount))
  let whole = ''
  let fraction = ''
  for (const part of parts) {
    if (part.type === 'decimal' || part.type === 'fraction') fraction += part.value
    else whole += part.value
  }
  return { whole, fraction, suffix: ` ${currency}` }
}

export function formatDate(value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(intlTag(), { timeZone: companyZone, ...options }).format(toDate(value))
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
