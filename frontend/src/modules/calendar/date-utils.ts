import { intlTag } from '@/shared/lib/format'
// Helpers minime, fără dependință nouă (nicio librărie de date în frontend încă) —
// suficient pt. o vedere săptămână/lună, nu justifică date-fns/dayjs (regula #10 no bloat).

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm', 'Dum']
export const MONTH_LABELS = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
]

export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Luni ca prima zi a săptămânii. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  const day = d.getDay() // 0=duminică
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function addMonths(date: Date, n: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(intlTag(), { hour: '2-digit', minute: '2-digit' })
}

/** "2026-07-20T09:00" (fără offset) — input-ul <input type="datetime-local"> îl citește ca oră locală. */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
