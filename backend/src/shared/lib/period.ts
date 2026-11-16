// Parsează perioada din query (?period=30d|7d|90d|mtd|ytd) sau from/to custom.
export interface PeriodRange {
  from: Date
  to: Date
}

export function resolvePeriod(period?: string, from?: string, to?: string): PeriodRange {
  const now = new Date()
  if (from && to) return { from: new Date(from), to: new Date(to) }

  switch (period ?? '30d') {
    case 'mtd':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
    case 'ytd':
      return { from: new Date(now.getFullYear(), 0, 1), to: now }
    case '7d':
      return { from: daysAgo(now, 7), to: now }
    case '90d':
      return { from: daysAgo(now, 90), to: now }
    case '30d':
    default:
      return { from: daysAgo(now, 30), to: now }
  }
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The period a figure is compared with. `previous` = the same length right before; for `mtd` the
 * same days of last month (on 31 March that is 1-28/29 February, not the whole of February),
 * because comparing 15 days with a full month always looks like a drop. A date (YYYY-MM-DD)
 * starts a period of the same length there.
 */
export function resolveComparePeriod(range: PeriodRange, compare: string, period?: string): PeriodRange {
  if (compare !== 'previous') {
    const from = new Date(`${compare}T00:00:00.000Z`)
    return { from, to: new Date(from.getTime() + (range.to.getTime() - range.from.getTime())) }
  }
  if (period === 'mtd') {
    const from = new Date(range.from)
    from.setMonth(from.getMonth() - 1)
    const monthEnd = new Date(range.from.getTime() - 1)
    const to = new Date(range.to)
    to.setDate(1)
    to.setMonth(to.getMonth() - 1)
    // Past the last day of the shorter month the whole of it counts (31 March → all of February).
    if (range.to.getDate() > daysInMonth(to)) return { from, to: monthEnd }
    to.setDate(range.to.getDate())
    return { from, to }
  }
  const length = range.to.getTime() - range.from.getTime()
  return { from: new Date(range.from.getTime() - length), to: new Date(range.from.getTime()) }
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

/** `abs` as a string with two decimals, like the amounts; `pct` null when there is nothing to compare with. */
export function delta(current: number, previous: number): { abs: string; pct: number | null } {
  return {
    abs: (current - previous).toFixed(2),
    pct: previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10,
  }
}

/** The calendar day of `date` in the company's time zone, as YYYY-MM-DD. */
export function dayInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function isWorkingDay(isoDay: string): boolean {
  const weekday = new Date(`${isoDay}T12:00:00Z`).getUTCDay()
  return weekday !== 0 && weekday !== 6
}

function addDays(isoDay: string, days: number): string {
  return new Date(new Date(`${isoDay}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Run-rate forecast to the end of the month of `today`: the average of the finished working days of
 * this month (today is still running, so it does not count), spread over the working days left,
 * today included. Weekends get nothing. Empty when no working day of the month has finished yet.
 */
export function forecastToMonthEnd(
  dailyValues: Map<string, number>,
  today: string,
): { date: string; value: number }[] {
  const monthStart = `${today.slice(0, 8)}01`
  let workedDays = 0
  let total = 0
  for (let day = monthStart; day < today; day = addDays(day, 1)) {
    if (!isWorkingDay(day)) continue
    workedDays += 1
    total += dailyValues.get(day) ?? 0
  }
  if (workedDays === 0) return []
  const perDay = Math.round((total / workedDays) * 100) / 100
  const out: { date: string; value: number }[] = []
  for (let day = today; day.slice(0, 7) === today.slice(0, 7); day = addDays(day, 1)) {
    out.push({ date: day, value: isWorkingDay(day) ? perDay : 0 })
  }
  return out
}
