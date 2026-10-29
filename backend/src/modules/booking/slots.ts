import { wallClock, zonedTimeToUtc } from '../../shared/lib/schedule-recurrence.js'
import type { BookingSettings } from './schema.js'

// Calculul de sloturi, fără DB: primește setările, momentul curent și intervalele ocupate, și
// întoarce sloturile libere. Orele de programări sunt pe ceasul firmei (fusul ei orar), deci un
// „10:00" rămâne 10:00 local și după trecerea la ora de iarnă.

export interface Interval {
  start: Date
  end: Date
}

export interface Slot {
  start: Date
  end: Date
}

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

function parseTime(hhmm: string): { h: number; min: number } {
  const [h, min] = hhmm.split(':').map(Number)
  return { h: h ?? 0, min: min ?? 0 }
}

/** Ziua calendaristică din fusul firmei, decalată cu `offsetDays` față de `date` (y-m-d local). */
function zonedDate(date: Date, offsetDays: number, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const local = wallClock(date, timeZone)
  // Prânzul UTC al zilei locale: departe de miezul nopții, deci adunarea de zile nu sare peste DST.
  const noon = new Date(Date.UTC(local.y, local.m - 1, local.d, 12) + offsetDays * DAY_MS)
  const jsWeekday = noon.getUTCDay()
  return { y: noon.getUTCFullYear(), m: noon.getUTCMonth() + 1, d: noon.getUTCDate(), weekday: jsWeekday === 0 ? 7 : jsWeekday }
}

/** Un eveniment de o zi întreagă ocupă zilele locale pe care le atinge, de la miezul nopții la miezul nopții. */
export function allDayToInterval(start: Date, end: Date, timeZone: string): Interval {
  const first = wallClock(start, timeZone)
  const last = wallClock(end, timeZone)
  const endsAtMidnight = end > start && last.h === 0 && last.min === 0
  const lastDay = endsAtMidnight ? zonedDate(end, -1, timeZone) : { y: last.y, m: last.m, d: last.d }
  const next = new Date(Date.UTC(lastDay.y, lastDay.m - 1, lastDay.d, 12) + DAY_MS)
  return {
    start: zonedTimeToUtc(first.y, first.m, first.d, 0, 0, timeZone),
    end: zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone),
  }
}

export function computeSlots(settings: BookingSettings, now: Date, busy: Interval[], days: number, timeZone: string): Slot[] {
  if (!settings.enabled) return []
  const durationMs = settings.durationMin * MINUTE_MS
  const bufferMs = settings.bufferMin * MINUTE_MS
  const earliest = now.getTime() + settings.minNoticeHours * 60 * MINUTE_MS
  const latest = now.getTime() + settings.horizonDays * DAY_MS
  const dayCount = Math.min(days, settings.horizonDays)

  const slots: Slot[] = []
  for (let offset = 0; offset <= dayCount; offset++) {
    const day = zonedDate(now, offset, timeZone)
    for (const window of settings.weekly.filter((w) => w.weekday === day.weekday)) {
      const from = parseTime(window.start)
      const to = parseTime(window.end)
      const windowEnd = zonedTimeToUtc(day.y, day.m, day.d, to.h, to.min, timeZone).getTime()
      let cursor = zonedTimeToUtc(day.y, day.m, day.d, from.h, from.min, timeZone).getTime()
      for (; cursor + durationMs <= windowEnd; cursor += durationMs) {
        if (cursor < earliest || cursor >= latest) continue
        const slotEnd = cursor + durationMs
        const clashes = busy.some((b) => cursor < b.end.getTime() + bufferMs && slotEnd > b.start.getTime() - bufferMs)
        if (!clashes) slots.push({ start: new Date(cursor), end: new Date(slotEnd) })
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime())
}
