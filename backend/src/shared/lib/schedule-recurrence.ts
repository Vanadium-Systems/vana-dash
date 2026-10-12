// Recurența task-urilor programate din chat (PLAN.md Contract B). Toate calculele păstrează
// ora pe ceasul lui Stefan (Europe/Bucharest, UTC+2/+3) — „zilnic la 18" trebuie să rămână
// la 18 locale și peste trecerea DST, nu să alunece cu o oră în UTC.

const TIME_ZONE = 'Europe/Bucharest'

function tzOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
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

// Instanța UTC care arată exact (y-m-d h:min) pe ceasul local Bucharest. Double-offset pt.
// momentele ambigue din jurul schimbării DST (o singură recalculare e standardul practic).
export function bucharestTimeToUtc(
  y: number,
  month: number,
  d: number,
  h: number,
  min: number,
): Date {
  const guess = Date.UTC(y, month - 1, d, h, min)
  const offsetBefore = tzOffsetMs(new Date(guess))
  let ts = guess - offsetBefore
  const offsetAfter = tzOffsetMs(new Date(ts))
  if (offsetAfter !== offsetBefore) ts = guess - offsetAfter
  return new Date(ts)
}

export function wallClock(date: Date): { y: number; m: number; d: number; h: number; min: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
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
export function nextRecurrenceRun(from: Date, recurrence: 'daily' | 'weekly', weekday?: number | null): Date {
  const w = wallClock(from)
  let daysAhead = 1
  if (recurrence === 'weekly') {
    const target = weekday ?? w.weekday
    daysAhead = (target - w.weekday + 7) % 7 || 7
  }
  const nextUtcMidnight = Date.UTC(w.y, w.m - 1, w.d + daysAhead)
  const [isoY, isoM, isoD] = new Date(nextUtcMidnight).toISOString().slice(0, 10).split('-')
  return bucharestTimeToUtc(Number(isoY), Number(isoM), Number(isoD), w.h, w.min)
}

export const STALE_RUN_DAYS = 7

/** Pending-uri mai vechi de atât nu se mai livrează întârziate — se marchează failed. */
export function isStaleRun(runAt: Date, now: Date): boolean {
  return now.getTime() - runAt.getTime() > STALE_RUN_DAYS * 24 * 60 * 60 * 1000
}
