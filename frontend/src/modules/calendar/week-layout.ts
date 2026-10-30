import type { CalendarOccurrence } from '@/shared/lib/types'

// Placement of timed events in one day column of the week grid. An event that crosses midnight
// shows on every day it touches, cut at the edges of the visible hours; events that overlap share
// the width side by side instead of covering each other.

export interface DayGrid {
  startHour: number
  endHour: number
  hourHeight: number
}

export interface PlacedOccurrence {
  occ: CalendarOccurrence
  top: number
  height: number
  /** 0-based column inside its group of overlapping events, out of `columns`. */
  column: number
  columns: number
}

const MIN_DURATION_MS = 30 * 60 * 1000

function dayBounds(day: Date, grid: DayGrid): [number, number] {
  const from = new Date(day)
  from.setHours(grid.startHour, 0, 0, 0)
  const to = new Date(day)
  to.setHours(0, 0, 0, 0)
  to.setTime(to.getTime() + grid.endHour * 3_600_000)
  return [from.getTime(), to.getTime()]
}

export function layoutDay(occurrences: CalendarOccurrence[], day: Date, grid: DayGrid): PlacedOccurrence[] {
  const [dayFrom, dayTo] = dayBounds(day, grid)
  const pieces = occurrences
    .filter((occ) => !occ.allDay)
    .map((occ) => {
      const start = new Date(occ.occurrenceStart).getTime()
      const end = Math.max(new Date(occ.occurrenceEnd).getTime(), start + MIN_DURATION_MS)
      return { occ, from: Math.max(start, dayFrom), to: Math.min(end, dayTo) }
    })
    .filter((piece) => piece.to > piece.from)
    .sort((a, b) => a.from - b.from || b.to - a.to)

  const placed: PlacedOccurrence[] = []
  let group: Array<{ piece: (typeof pieces)[number]; column: number }> = []
  let columnEnds: number[] = []
  let groupEnd = -Infinity

  const closeGroup = () => {
    for (const { piece, column } of group) {
      placed.push({
        occ: piece.occ,
        top: ((piece.from - dayFrom) / 3_600_000) * grid.hourHeight,
        height: ((piece.to - piece.from) / 3_600_000) * grid.hourHeight,
        column,
        columns: columnEnds.length,
      })
    }
    group = []
    columnEnds = []
  }

  for (const piece of pieces) {
    if (piece.from >= groupEnd) closeGroup()
    let column = columnEnds.findIndex((end) => end <= piece.from)
    if (column === -1) column = columnEnds.push(piece.to) - 1
    else columnEnds[column] = piece.to
    group.push({ piece, column })
    groupEnd = Math.max(groupEnd, piece.to)
  }
  closeGroup()
  return placed
}

/** All-day events that cover `day`, including the middle and last days of a multi-day one. */
export function allDayOn(occurrences: CalendarOccurrence[], day: Date): CalendarOccurrence[] {
  const from = new Date(day)
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return occurrences.filter((occ) => {
    if (!occ.allDay) return false
    const start = new Date(occ.occurrenceStart).getTime()
    // An all-day event stored with end == start still covers its own day.
    const end = Math.max(new Date(occ.occurrenceEnd).getTime(), start + 1)
    return start < to.getTime() && end > from.getTime()
  })
}

/** Inline position of a placed event inside its day column. */
export function placedStyle(placed: PlacedOccurrence): { top: number; height: number; left: string; width: string } {
  const share = 100 / placed.columns
  return {
    top: placed.top,
    height: Math.max(placed.height - 2, 12),
    left: `calc(${placed.column * share}% + 2px)`,
    width: `calc(${share}% - 4px)`,
  }
}
