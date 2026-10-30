import { companyTimeZone, intlTag } from '@/shared/lib/format'

function dayInCompanyZone(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: companyTimeZone() })
}

// The company's time; the weekday shows only when the moment is not today (weekends, holidays).
export function formatSessionTime(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString(intlTag(), { timeZone: companyTimeZone(), hour: '2-digit', minute: '2-digit' })
  if (dayInCompanyZone(at) === dayInCompanyZone(now)) return time
  const day = at.toLocaleDateString(intlTag(), { timeZone: companyTimeZone(), weekday: 'long', day: 'numeric', month: 'short' })
  return `${day}, ${time}`
}

// Prețurile se actualizează doar cât bursa e deschisă; închisă, o vârstă de 60 h e normală.
const PRICES_LATE_AFTER_SEC = 15 * 60

export function pricesLate(isOpen: boolean, oldestAgeSec: number): boolean {
  return isOpen && oldestAgeSec > PRICES_LATE_AFTER_SEC
}
