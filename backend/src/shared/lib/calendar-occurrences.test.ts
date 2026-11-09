import { describe, expect, it } from 'vitest'
import type { calendarEvents } from '../db/schema/index.js'
import { expandOccurrence, rotateByDay, seriesStarts, wallDayDelta, type ExceptionRow } from './calendar-occurrences.js'

const TZ = 'Europe/Bucharest'
type Row = typeof calendarEvents.$inferSelect

const wall = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16)

function series(startIso: string, endIso: string, rule: string, extra: Partial<Row> = {}): Row {
  return {
    id: 'series-1',
    tenantId: 't',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    ownerUserId: 'u',
    title: 'Weekly sync',
    description: null,
    location: null,
    startAt: new Date(startIso),
    endAt: new Date(endIso),
    allDay: false,
    recurrenceRule: rule,
    recurrenceEndAt: null,
    color: null,
    reminderMinutesBefore: null,
    reminderSentAt: null,
    source: 'manual',
    ...extra,
  }
}

describe('seriesStarts across DST', () => {
  it('keeps a weekly 10:00 at 10:00 through the October change', () => {
    // 2026-10-05 is a Monday, 10:00 in Bucharest (UTC+3).
    const row = series('2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z', 'FREQ=WEEKLY;BYDAY=MO')
    const starts = seriesStarts(row, new Date('2026-10-15T00:00Z'), new Date('2026-11-05T00:00Z'), TZ)
    expect(starts.map((d) => wall(d.toISOString()))).toEqual(['2026-10-19 10:00', '2026-10-26 10:00', '2026-11-02 10:00'])
    expect(starts[1]!.toISOString()).toBe('2026-10-26T08:00:00.000Z')
  })

  it('keeps a weekly 10:00 at 10:00 through the March change', () => {
    const row = series('2026-03-16T08:00:00Z', '2026-03-16T09:00:00Z', 'FREQ=WEEKLY;BYDAY=MO')
    const starts = seriesStarts(row, new Date('2026-03-20T00:00Z'), new Date('2026-04-10T00:00Z'), TZ)
    expect(starts.map((d) => wall(d.toISOString()))).toEqual(['2026-03-23 10:00', '2026-03-30 10:00', '2026-04-06 10:00'])
  })

  it('expands "the fourth Thursday" on the wall clock', () => {
    const row = series('2026-09-24T07:00:00Z', '2026-09-24T08:00:00Z', 'FREQ=MONTHLY;BYDAY=+4TH')
    const starts = seriesStarts(row, new Date('2026-09-01T00:00Z'), new Date('2026-12-31T00:00Z'), TZ)
    expect(starts.map((d) => wall(d.toISOString()))).toEqual([
      '2026-09-24 10:00',
      '2026-10-22 10:00',
      '2026-11-26 10:00',
      '2026-12-24 10:00',
    ])
  })

  it('moves a time that does not exist on the spring night an hour later', () => {
    const row = series('2026-03-27T01:30:00Z', '2026-03-27T02:00:00Z', 'FREQ=DAILY')
    const starts = seriesStarts(row, new Date('2026-03-27T00:00Z'), new Date('2026-03-31T00:00Z'), TZ)
    expect(starts.map((d) => wall(d.toISOString()))).toEqual([
      '2026-03-27 03:30',
      '2026-03-28 03:30',
      '2026-03-29 04:30',
      '2026-03-30 03:30',
    ])
  })

  it('stops at the end of the series', () => {
    const row = series('2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z', 'FREQ=WEEKLY;BYDAY=MO', {
      recurrenceEndAt: new Date('2026-10-20T00:00Z'),
    })
    const starts = seriesStarts(row, new Date('2026-10-01T00:00Z'), new Date('2026-11-30T00:00Z'), TZ)
    expect(starts).toHaveLength(3)
  })
})

describe('expandOccurrence with exceptions', () => {
  const row = series('2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z', 'FREQ=WEEKLY;BYDAY=MO')
  const from = new Date('2026-10-12T00:00Z')
  const to = new Date('2026-10-31T00:00Z')

  it('drops a cancelled occurrence', () => {
    const exceptions: ExceptionRow[] = [
      { eventId: row.id, occurrenceStart: new Date('2026-10-19T07:00:00Z'), kind: 'cancelled', startAt: null, endAt: null, overrides: {} },
    ]
    const keys = expandOccurrence(row, from, to, TZ, exceptions).map((o) => o.occurrenceKey)
    expect(keys).toEqual(['2026-10-12T07:00:00.000Z', '2026-10-26T08:00:00.000Z'])
  })

  it('shows a moved occurrence at its new time, with its overrides and its key', () => {
    const exceptions: ExceptionRow[] = [
      {
        eventId: row.id,
        occurrenceStart: new Date('2026-10-19T07:00:00Z'),
        kind: 'moved',
        startAt: new Date('2026-10-20T11:00:00Z'),
        endAt: new Date('2026-10-20T12:00:00Z'),
        overrides: { title: 'Moved sync' },
      },
    ]
    const moved = expandOccurrence(row, from, to, TZ, exceptions).find((o) => o.isException)
    expect(moved).toMatchObject({
      occurrenceStart: '2026-10-20T11:00:00.000Z',
      occurrenceKey: '2026-10-19T07:00:00.000Z',
      title: 'Moved sync',
    })
  })

  it('shows an occurrence moved into the window from outside it', () => {
    const exceptions: ExceptionRow[] = [
      {
        eventId: row.id,
        occurrenceStart: new Date('2026-11-02T08:00:00Z'),
        kind: 'moved',
        startAt: new Date('2026-10-30T08:00:00Z'),
        endAt: new Date('2026-10-30T09:00:00Z'),
        overrides: {},
      },
    ]
    const occ = expandOccurrence(row, from, to, TZ, exceptions)
    expect(occ.map((o) => o.occurrenceStart)).toContain('2026-10-30T08:00:00.000Z')
  })

  it('ignores an exception whose key the series no longer produces', () => {
    const exceptions: ExceptionRow[] = [
      {
        eventId: row.id,
        occurrenceStart: new Date('2026-10-21T07:00:00Z'),
        kind: 'moved',
        startAt: new Date('2026-10-22T07:00:00Z'),
        endAt: new Date('2026-10-22T08:00:00Z'),
        overrides: {},
      },
    ]
    expect(expandOccurrence(row, from, to, TZ, exceptions)).toHaveLength(3)
  })

  it('includes an occurrence that started before the window and is still running', () => {
    const long = series('2026-10-05T07:00:00Z', '2026-10-05T19:00:00Z', 'FREQ=WEEKLY;BYDAY=MO')
    const occ = expandOccurrence(long, new Date('2026-10-12T12:00Z'), new Date('2026-10-12T13:00Z'), TZ)
    expect(occ).toHaveLength(1)
  })
})

describe('rotateByDay', () => {
  it('moves plain weekdays and keeps the other parts', () => {
    expect(rotateByDay('FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2', 1)).toBe('FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2')
  })
  it('wraps around the week, backwards too', () => {
    expect(rotateByDay('FREQ=WEEKLY;BYDAY=SU', 1)).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(rotateByDay('FREQ=WEEKLY;BYDAY=MO', -1)).toBe('FREQ=WEEKLY;BYDAY=SU')
  })
  it('keeps ordinals', () => {
    expect(rotateByDay('FREQ=MONTHLY;BYDAY=+4TH', 1)).toBe('FREQ=MONTHLY;BYDAY=+4FR')
  })
  it('leaves a rule without BYDAY alone', () => {
    expect(rotateByDay('FREQ=DAILY', 3)).toBe('FREQ=DAILY')
  })
})

describe('wallDayDelta', () => {
  it('counts calendar days in the company zone, not 24h blocks', () => {
    // 23:30 Monday → 00:30 Tuesday local is one day although only an hour passed.
    expect(wallDayDelta(new Date('2026-10-19T20:30:00Z'), new Date('2026-10-19T21:30:00Z'), TZ)).toBe(1)
  })
})
