import { describe, expect, it } from 'vitest'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { allDayOn, drawnRange, dragTarget, layoutDay, resizeTarget, timeAt } from './week-layout'

const grid = { startHour: 0, endHour: 24, hourHeight: 48 }
const day = new Date(2026, 9, 27)
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
const occ = (id: string, start: string, end: string, allDay = false) =>
  ({ eventId: id, occurrenceStart: start, occurrenceEnd: end, allDay }) as CalendarOccurrence

describe('layoutDay', () => {
  it('puts overlapping events side by side', () => {
    const placed = layoutDay([occ('a', at(27, 9), at(27, 11)), occ('b', at(27, 10), at(27, 12)), occ('c', at(27, 13), at(27, 14))], day, grid)
    const byId = Object.fromEntries(placed.map((p) => [p.occ.eventId, p]))
    expect([byId.a?.column, byId.a?.columns]).toEqual([0, 2])
    expect([byId.b?.column, byId.b?.columns]).toEqual([1, 2])
    expect([byId.c?.column, byId.c?.columns]).toEqual([0, 1])
    expect(byId.a?.top).toBe(9 * 48)
  })

  it('shows an event after midnight on both days, cut at the edges', () => {
    const night = occ('n', at(27, 22), at(28, 2))
    expect(layoutDay([night], day, grid)[0]).toMatchObject({ top: 22 * 48, height: 2 * 48 })
    expect(layoutDay([night], new Date(2026, 9, 28), grid)[0]).toMatchObject({ top: 0, height: 2 * 48 })
  })

  it('leaves out all-day events and other days', () => {
    expect(layoutDay([occ('x', at(27, 0), at(28, 0), true), occ('y', at(26, 9), at(26, 10))], day, grid)).toEqual([])
  })
})

describe('allDayOn', () => {
  it('covers every day of a multi-day event', () => {
    const trip = occ('t', at(26, 0), at(29, 0), true)
    expect(allDayOn([trip], new Date(2026, 9, 28))).toHaveLength(1)
    expect(allDayOn([trip], new Date(2026, 9, 29))).toHaveLength(0)
    expect(allDayOn([occ('s', at(27, 0), at(27, 0), true)], day)).toHaveLength(1)
  })
})

describe('dragging on the grid', () => {
  const start = new Date(2026, 9, 27, 10, 0)
  const end = new Date(2026, 9, 27, 11, 0)

  it('snaps a vertical drag to 15 minutes and keeps the duration', () => {
    // 20px of 48px per hour = 25 min → 30 min after snapping.
    const target = dragTarget(start, end, 0, 20, grid)
    expect(target.start).toEqual(new Date(2026, 9, 27, 10, 30))
    expect(target.end).toEqual(new Date(2026, 9, 27, 11, 30))
  })

  it('moves across days by the column under the pointer', () => {
    const target = dragTarget(start, end, 2, -48, grid)
    expect(target.start).toEqual(new Date(2026, 9, 29, 9, 0))
  })

  it('keeps a resize at least one snap long and inside its day', () => {
    expect(resizeTarget(start, end, -200, grid)).toEqual(new Date(2026, 9, 27, 10, 15))
    expect(resizeTarget(start, end, 48 * 30, grid)).toEqual(new Date(2026, 9, 28, 0, 0))
    expect(resizeTarget(start, end, 12, grid)).toEqual(new Date(2026, 9, 27, 11, 15))
  })

  it('reads the snapped time under an offset, clamped to the grid', () => {
    expect(timeAt(day, 48 * 9 + 10, grid)).toEqual(new Date(2026, 9, 27, 9, 15))
    expect(timeAt(day, -30, grid)).toEqual(new Date(2026, 9, 27, 0, 0))
  })

  it('draws a range upwards or downwards, and a click gives the hour slot', () => {
    expect(drawnRange(day, 48 * 11, 48 * 9, grid)).toEqual({ start: new Date(2026, 9, 27, 9, 0), end: new Date(2026, 9, 27, 11, 0) })
    expect(drawnRange(day, 48 * 14 + 30, 48 * 14 + 32, grid)).toEqual({ start: new Date(2026, 9, 27, 14, 0), end: new Date(2026, 9, 27, 15, 0) })
  })
})
