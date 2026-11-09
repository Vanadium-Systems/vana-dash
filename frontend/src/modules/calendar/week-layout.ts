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

// ── Dragging, resizing and drawing a range on the grid (FE2). Pure, so the snapping and the
// limits are tested without a DOM; the grid only feeds pointer offsets in.

export const SNAP_MINUTES = 15
const MINUTE_MS = 60_000

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
}

/** The snapped time under a vertical offset (px from the top of the day column). */
export function timeAt(day: Date, offsetY: number, grid: DayGrid): Date {
  const minutes = snapMinutes(grid.startHour * 60 + (offsetY / grid.hourHeight) * 60)
  const clamped = Math.min(Math.max(minutes, grid.startHour * 60), grid.endHour * 60)
  const time = new Date(day)
  time.setHours(0, 0, 0, 0)
  time.setMinutes(clamped)
  return time
}

/**
 * Where a dragged event lands: moved by whole days (the column under the pointer) and by snapped
 * minutes (the vertical distance dragged), keeping its duration.
 */
export function dragTarget(start: Date, end: Date, dayDelta: number, offsetPx: number, grid: DayGrid): { start: Date; end: Date } {
  const minutes = snapMinutes((offsetPx / grid.hourHeight) * 60)
  const next = new Date(start)
  next.setDate(next.getDate() + dayDelta)
  next.setTime(next.getTime() + minutes * MINUTE_MS)
  return { start: next, end: new Date(next.getTime() + (end.getTime() - start.getTime())) }
}

/** The new end while the bottom edge is dragged: at least one snap after the start, at most the end of its day. */
export function resizeTarget(start: Date, end: Date, offsetPx: number, grid: DayGrid): Date {
  const minutes = snapMinutes((offsetPx / grid.hourHeight) * 60)
  const dayEnd = new Date(start)
  dayEnd.setHours(0, 0, 0, 0)
  dayEnd.setTime(dayEnd.getTime() + grid.endHour * 3_600_000)
  const next = end.getTime() + minutes * MINUTE_MS
  return new Date(Math.min(Math.max(next, start.getTime() + SNAP_MINUTES * MINUTE_MS), Math.max(dayEnd.getTime(), end.getTime())))
}

/** A range drawn on one day, in either direction; a click without drag gives one hour. */
export function drawnRange(day: Date, fromY: number, toY: number, grid: DayGrid): { start: Date; end: Date } {
  const a = timeAt(day, Math.min(fromY, toY), grid)
  let b = timeAt(day, Math.max(fromY, toY), grid)
  if (b.getTime() - a.getTime() < SNAP_MINUTES * MINUTE_MS) {
    // A plain click: the hour slot it fell in.
    const slot = new Date(day)
    slot.setHours(0, 0, 0, 0)
    slot.setMinutes(Math.floor((grid.startHour * 60 + (fromY / grid.hourHeight) * 60) / 60) * 60)
    return { start: slot, end: new Date(slot.getTime() + 60 * MINUTE_MS) }
  }
  if (b.getTime() <= a.getTime()) b = new Date(a.getTime() + SNAP_MINUTES * MINUTE_MS)
  return { start: a, end: b }
}
