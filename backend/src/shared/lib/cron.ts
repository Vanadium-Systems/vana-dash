export interface ScheduledTask {
  stop: () => void
  start: () => void
}

export interface ScheduleOptions {
  timezone?: string
}

export interface ParsedCron {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  domWildcard: boolean
  dowWildcard: boolean
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function parseField(field: string, min: number, max: number, normalizeSevenToZero = false): Set<number> | null {
  const result = new Set<number>()
  const parts = field.split(',')

  for (const part of parts) {
    if (!part) return null
    const slashParts = part.split('/')
    if (slashParts.length > 2) return null

    const [rangeStr, stepStr] = slashParts
    if (!rangeStr) return null
    let step = 1
    if (stepStr !== undefined) {
      if (!/^\d+$/.test(stepStr)) return null
      step = Number(stepStr)
      if (step <= 0) return null
    }

    let start: number
    let end: number

    if (rangeStr === '*') {
      start = min
      end = max
    } else if (rangeStr.includes('-')) {
      const [startStr, endStr, ...rest] = rangeStr.split('-')
      if (rest.length > 0 || !startStr || !endStr || !/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) return null
      start = Number(startStr)
      end = Number(endStr)
      if (start > end || start < min || end > max) return null
    } else {
      if (!/^\d+$/.test(rangeStr)) return null
      start = Number(rangeStr)
      if (start < min || start > max) return null
      end = stepStr !== undefined ? max : start
    }

    for (let v = start; v <= end; v += step) {
      result.add(normalizeSevenToZero && v === 7 ? 0 : v)
    }
  }

  return result.size > 0 ? result : null
}

export function parseCron(expr: string): ParsedCron | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const [minStr, hourStr, domStr, monthStr, dowStr] = fields
  if (!minStr || !hourStr || !domStr || !monthStr || !dowStr) return null
  const minutes = parseField(minStr, 0, 59)
  const hours = parseField(hourStr, 0, 23)
  const daysOfMonth = parseField(domStr, 1, 31)
  const months = parseField(monthStr, 1, 12)
  const daysOfWeek = parseField(dowStr, 0, 7, true)

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domWildcard: domStr === '*',
    dowWildcard: dowStr === '*',
  }
}

export function validate(expr: string): boolean {
  if (typeof expr !== 'string') return false
  return parseCron(expr) !== null
}

function getDateParts(date: Date, timezone?: string): {
  minute: number
  hour: number
  dayOfMonth: number
  month: number
  dayOfWeek: number
} {
  if (!timezone) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
    }
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')) % 24,
    dayOfMonth: Number(get('day')),
    month: Number(get('month')),
    dayOfWeek: WEEKDAY_MAP[get('weekday')] ?? 0,
  }
}

export function matchesCron(parsed: ParsedCron, date: Date, timezone?: string): boolean {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = getDateParts(date, timezone)

  if (!parsed.minutes.has(minute)) return false
  if (!parsed.hours.has(hour)) return false
  if (!parsed.months.has(month)) return false

  if (!parsed.domWildcard && !parsed.dowWildcard) {
    return parsed.daysOfMonth.has(dayOfMonth) || parsed.daysOfWeek.has(dayOfWeek)
  }
  return parsed.daysOfMonth.has(dayOfMonth) && parsed.daysOfWeek.has(dayOfWeek)
}

export function schedule(expr: string, task: () => void, options?: ScheduleOptions): ScheduledTask {
  const parsed = parseCron(expr)
  if (!parsed) {
    throw new Error(`Invalid cron expression: ${expr}`)
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let lastFiredEpochMinute = -1

  const tick = () => {
    if (stopped) return
    const now = Date.now()
    const epochMinute = Math.floor(now / 60_000)

    if (epochMinute > lastFiredEpochMinute) {
      lastFiredEpochMinute = epochMinute
      if (matchesCron(parsed, new Date(now), options?.timezone)) {
        try {
          task()
        } catch (err) {
          console.error('[cron] Unhandled error in scheduled task:', err)
        }
      }
    }

    if (!stopped) {
      const msUntilNextMinute = 60_000 - (Date.now() % 60_000) + 5
      timer = setTimeout(tick, msUntilNextMinute)
    }
  }

  const start = () => {
    if (timer) return
    stopped = false
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000) + 5
    timer = setTimeout(tick, msUntilNextMinute)
  }

  const stop = () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  start()
  return { stop, start }
}

export default { validate, schedule }
