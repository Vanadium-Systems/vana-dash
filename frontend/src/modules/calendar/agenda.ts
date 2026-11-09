import type { CalendarOccurrence } from '@/shared/lib/types'
import { addDays, startOfDay } from './date-utils'

export interface AgendaDay {
  day: Date
  items: CalendarOccurrence[]
}

/** Days from `from` onward that have events, plus today, which shows even when empty. */
export function groupAgenda(occurrences: CalendarOccurrence[], from: Date): AgendaDay[] {
  const first = startOfDay(from)
  const byDay = new Map<number, AgendaDay>()
  const dayEntry = (day: Date): AgendaDay => {
    const key = day.getTime()
    let entry = byDay.get(key)
    if (!entry) {
      entry = { day, items: [] }
      byDay.set(key, entry)
    }
    return entry
  }
  dayEntry(first)

  for (const occ of occurrences) {
    const start = new Date(occ.occurrenceStart)
    if (!occ.allDay) {
      const day = startOfDay(start)
      if (day.getTime() >= first.getTime()) dayEntry(day).items.push(occ)
      continue
    }
    // An all-day event stored with end == start still covers its own day.
    const last = startOfDay(new Date(Math.max(new Date(occ.occurrenceEnd).getTime(), start.getTime() + 1) - 1))
    for (let day = startOfDay(start); day.getTime() <= last.getTime(); day = addDays(day, 1)) {
      if (day.getTime() >= first.getTime()) dayEntry(day).items.push(occ)
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.day.getTime() - b.day.getTime())
  for (const entry of days) {
    entry.items.sort(
      (a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.occurrenceStart).getTime() - new Date(b.occurrenceStart).getTime(),
    )
  }
  return days
}
