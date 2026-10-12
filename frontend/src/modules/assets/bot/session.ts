import { intlTag } from '@/shared/lib/format'
const TZ = 'Europe/Bucharest'

function dayInBucharest(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: TZ })
}

// Ora României; ziua săptămânii apare doar când momentul nu e azi (weekend, sărbători).
export function formatSessionTime(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString(intlTag(), { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  if (dayInBucharest(at) === dayInBucharest(now)) return time
  const day = at.toLocaleDateString(intlTag(), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' })
  return `${day}, ${time}`
}

// Prețurile se actualizează doar cât bursa e deschisă; închisă, o vârstă de 60 h e normală.
const PRICES_LATE_AFTER_SEC = 15 * 60

export function pricesLate(isOpen: boolean, oldestAgeSec: number): boolean {
  return isOpen && oldestAgeSec > PRICES_LATE_AFTER_SEC
}
