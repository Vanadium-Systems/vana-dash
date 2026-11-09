import { describe, expect, it } from 'vitest'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { groupAgenda } from './agenda'

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
const occ = (id: string, start: string, end: string, allDay = false) =>
  ({ eventId: id, occurrenceStart: start, occurrenceEnd: end, allDay }) as CalendarOccurrence
const today = new Date(2026, 9, 27, 14, 30)

describe('groupAgenda', () => {
  it('keeps today even when nothing is scheduled', () => {
    const days = groupAgenda([], today)
    expect(days).toHaveLength(1)
    expect(days[0]?.day.getDate()).toBe(27)
    expect(days[0]?.items).toEqual([])
  })

  it('groups by start day and sorts days and events', () => {
    const days = groupAgenda([occ('late', at(29, 15), at(29, 16)), occ('b', at(27, 16), at(27, 17)), occ('a', at(27, 9), at(27, 10))], today)
    expect(days.map((d) => d.day.getDate())).toEqual([27, 29])
    expect(days[0]?.items.map((o) => o.eventId)).toEqual(['a', 'b'])
  })

  it('puts all-day events first within a day', () => {
    const days = groupAgenda([occ('timed', at(27, 8), at(27, 9)), occ('day', at(27, 0), at(28, 0), true)], today)
    expect(days[0]?.items.map((o) => o.eventId)).toEqual(['day', 'timed'])
  })

  it('shows a multi-day all-day event on each day it covers, a timed one only on its start day', () => {
    const days = groupAgenda([occ('trip', at(27, 0), at(30, 0), true), occ('night', at(27, 22), at(28, 2))], today)
    expect(days.map((d) => d.day.getDate())).toEqual([27, 28, 29])
    expect(days.map((d) => d.items.map((o) => o.eventId))).toEqual([['trip', 'night'], ['trip'], ['trip']])
  })

  it('drops what lies before the first day and trims a multi-day event that began earlier', () => {
    const days = groupAgenda([occ('old', at(25, 9), at(25, 10)), occ('trip', at(25, 0), at(29, 0), true)], today)
    expect(days.map((d) => d.day.getDate())).toEqual([27, 28])
    expect(days.flatMap((d) => d.items.map((o) => o.eventId))).toEqual(['trip', 'trip'])
  })
})
