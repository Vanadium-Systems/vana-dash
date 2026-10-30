import { describe, expect, it } from 'vitest'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { allDayOn, layoutDay } from './week-layout'

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
