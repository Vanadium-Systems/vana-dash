/** Wall-clock date and time in the company's zone to the instant they mean ('2026-11-12', '10:00'). */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess)
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value)
  const shown = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
  return new Date(guess.getTime() - (shown - guess.getTime()))
}

export function companyDay(now: Date, timeZone: string, plusDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
  const moved = new Date(`${today}T12:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() + plusDays)
  return moved.toISOString().slice(0, 10)
}

/** [start of the day, start of the next day) in the company's zone. */
export function dayRange(date: string, timeZone: string): { from: Date; to: Date } {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return { from: zonedInstant(date, '00:00', timeZone), to: zonedInstant(next.toISOString().slice(0, 10), '00:00', timeZone) }
}

/** 'HH:MM' on the company's wall clock, the inverse of `zonedInstant` for editing a stored time. */
export function companyClock(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}

/** Whole calendar days from `from` to `to` (both 'YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}
