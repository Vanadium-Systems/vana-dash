// Recurrence of the tasks scheduled from chat, and the wall-clock helpers booking uses. Every
// calculation keeps the hour on the company's clock (its time zone, from the company sheet):
// "daily at 18" stays at 18 local across a DST change instead of drifting an hour in UTC.

function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = new Map<string, number>()
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts.set(p.type, Number(p.value))
  }
  const asUtc = Date.UTC(
    parts.get('year')!,
    parts.get('month')! - 1,
    parts.get('day')!,
    parts.get('hour')!,
    parts.get('minute')!,
    parts.get('second')!,
  )
  return asUtc - date.getTime()
}

// Instanța UTC care arată exact (y-m-d h:min) pe ceasul local al firmei. Double-offset pt.
// momentele ambigue din jurul schimbării DST (o singură recalculare e standardul practic).
export function zonedTimeToUtc(
  y: number,
  month: number,
  d: number,
  h: number,
  min: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, month - 1, d, h, min)
  const offsetBefore = tzOffsetMs(new Date(guess), timeZone)
  let ts = guess - offsetBefore
  const offsetAfter = tzOffsetMs(new Date(ts), timeZone)
  if (offsetAfter !== offsetBefore) ts = guess - offsetAfter
  return new Date(ts)
}

export function wallClock(date: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const parts = new Map<string, string>()
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts.set(p.type, p.value)
  }
  // Convenția JS (Date.getDay): 0=duminică .. 6=sâmbătă — aceeași scalare ca `scheduled_runs.weekday`.
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weekdayIndex = weekdayNames.indexOf(parts.get('weekday')!)
  return {
    y: Number(parts.get('year')),
    m: Number(parts.get('month')),
    d: Number(parts.get('day')),
    h: Number(parts.get('hour')),
    min: Number(parts.get('minute')),
    weekday: weekdayIndex,
  }
}

/**
 * Următoarea rulare pentru un task recurent, cu ora fixată pe ceasul local:
 * daily = mâine la aceeași oră, weekly = următoarea apariție a zilei cerute (0-6, JS style;
 * null/absent = aceeași zi a săptămânii ca `from`). Downtime lung → se sare peste ocurențele
 * pierdute până prima rulare viitoare, nu se recuperează în rafală.
 */
export function nextRecurrenceRun(from: Date, recurrence: 'daily' | 'weekly', weekday: number | null | undefined, timeZone: string): Date {
  const w = wallClock(from, timeZone)
  let daysAhead = 1
  if (recurrence === 'weekly') {
    const target = weekday ?? w.weekday
    daysAhead = (target - w.weekday + 7) % 7 || 7
  }
  const nextUtcMidnight = Date.UTC(w.y, w.m - 1, w.d + daysAhead)
  const [isoY, isoM, isoD] = new Date(nextUtcMidnight).toISOString().slice(0, 10).split('-')
  return zonedTimeToUtc(Number(isoY), Number(isoM), Number(isoD), w.h, w.min, timeZone)
}

export const STALE_RUN_DAYS = 7

/** Pending-uri mai vechi de atât nu se mai livrează întârziate — se marchează failed. */
export function isStaleRun(runAt: Date, now: Date): boolean {
  return now.getTime() - runAt.getTime() > STALE_RUN_DAYS * 24 * 60 * 60 * 1000
}
