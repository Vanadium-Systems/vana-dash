// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { zonedDayEnd, zonedDayStart } from '@/shared/lib/format'
import { granularityFor, parsePeriod, presetRange, resolvePeriod, withPeriod } from './PeriodSelect'

describe('presetRange', () => {
  it('luna, luna trecută, trimestrul și anul, în zilele firmei', () => {
    expect(presetRange('thisMonth', '2026-02-10')).toEqual(['2026-02-01', '2026-02-28'])
    expect(presetRange('lastMonth', '2026-01-15')).toEqual(['2025-12-01', '2025-12-31'])
    expect(presetRange('thisQuarter', '2026-11-10')).toEqual(['2026-10-01', '2026-12-31'])
    expect(presetRange('thisYear', '2026-11-10')).toEqual(['2026-01-01', '2026-12-31'])
  })
})

const params = (search: string) => parsePeriod(new URLSearchParams(search))
const BUCHAREST = 'Europe/Bucharest'

describe('parsePeriod', () => {
  it('keeps the five windows and the two ranges', () => {
    for (const period of ['7d', '30d', '90d', 'mtd', 'ytd', 'lastMonth', 'thisQuarter']) expect(params(`period=${period}`)).toEqual({ period })
  })

  it('missing, unknown or incomplete custom is 30d', () => {
    expect(params('')).toEqual({ period: '30d' })
    expect(params('period=bogus')).toEqual({ period: '30d' })
    expect(params('period=custom')).toEqual({ period: '30d' })
    expect(params('period=custom&from=2026-03-01')).toEqual({ period: '30d' })
    expect(params('period=custom&from=2026-03-10&to=2026-03-01')).toEqual({ period: '30d' })
    expect(params('period=custom&from=2026-02-31&to=2026-03-01')).toEqual({ period: '30d' })
  })

  it('reads a custom range', () => {
    expect(params('period=custom&from=2026-03-01&to=2026-03-15')).toEqual({ period: 'custom', from: '2026-03-01', to: '2026-03-15' })
  })
})

describe('withPeriod', () => {
  it('keeps the other parameters and drops from/to unless custom', () => {
    const current = new URLSearchParams('metrica=profit&period=custom&from=2026-03-01&to=2026-03-15')
    expect(withPeriod(current, '7d').toString()).toBe('metrica=profit&period=7d')
    expect(withPeriod(current, 'custom', { from: '2026-04-01', to: '2026-04-02' }).toString()).toBe('metrica=profit&period=custom&from=2026-04-01&to=2026-04-02')
  })
})

describe('zoned days', () => {
  it('start and end of a day with a clock change are 23 hours apart', () => {
    expect(zonedDayStart('2026-03-29', BUCHAREST).toISOString()).toBe('2026-03-28T22:00:00.000Z')
    expect(zonedDayEnd('2026-03-29', BUCHAREST).toISOString()).toBe('2026-03-29T20:59:59.999Z')
    expect(zonedDayStart('2026-10-25', BUCHAREST).toISOString()).toBe('2026-10-24T21:00:00.000Z')
    expect(zonedDayEnd('2026-10-25', BUCHAREST).toISOString()).toBe('2026-10-25T21:59:59.999Z')
  })
})

describe('resolvePeriod', () => {
  const now = new Date('2026-04-10T10:00:00Z')

  it('a window stays a period token for the server', () => {
    expect(resolvePeriod({ period: 'mtd' }, now, BUCHAREST)).toEqual({ period: 'mtd', query: 'period=mtd', range: null, cacheKey: 'mtd' })
  })

  it('last month spans its whole days in the company zone', () => {
    const resolved = resolvePeriod({ period: 'lastMonth' }, now, BUCHAREST)
    expect(resolved.range).toEqual({ from: '2026-02-28T22:00:00.000Z', to: '2026-03-31T20:59:59.999Z' })
    expect(resolved.query).toBe('from=2026-02-28T22:00:00.000Z&to=2026-03-31T20:59:59.999Z')
    expect(resolved.cacheKey).toBe('lastMonth:2026-03-01:2026-03-31')
  })

  it('this quarter ends at now, not at the end of the quarter', () => {
    const resolved = resolvePeriod({ period: 'thisQuarter' }, now, BUCHAREST)
    expect(resolved.range).toEqual({ from: '2026-03-31T21:00:00.000Z', to: '2026-04-10T10:00:00.000Z' })
  })

  it('a custom range uses the company days, capped at now', () => {
    expect(resolvePeriod({ period: 'custom', from: '2026-03-28', to: '2026-03-29' }, now, BUCHAREST).range).toEqual({ from: '2026-03-27T22:00:00.000Z', to: '2026-03-29T20:59:59.999Z' })
    expect(resolvePeriod({ period: 'custom', from: '2026-04-01', to: '2026-04-30' }, now, BUCHAREST).range?.to).toBe('2026-04-10T10:00:00.000Z')
  })

  it('the day of "now" is the company day, not the UTC one', () => {
    const lateNight = new Date('2026-03-31T22:30:00Z')
    expect(resolvePeriod({ period: 'lastMonth' }, lateNight, BUCHAREST).cacheKey).toBe('lastMonth:2026-03-01:2026-03-31')
    expect(resolvePeriod({ period: 'lastMonth' }, lateNight, 'UTC').cacheKey).toBe('lastMonth:2026-02-01:2026-02-28')
  })
})

describe('granularityFor', () => {
  const span = (days: number) => ({ from: '2026-01-01T00:00:00.000Z', to: new Date(Date.parse('2026-01-01T00:00:00.000Z') + days * 86_400_000).toISOString() })

  it('windows keep their steps', () => {
    expect(granularityFor('7d', null)).toBe('day')
    expect(granularityFor('30d', null)).toBe('day')
    expect(granularityFor('mtd', null)).toBe('day')
    expect(granularityFor('90d', null)).toBe('week')
    expect(granularityFor('ytd', null)).toBe('month')
  })

  it('ranges: up to 31 days a day, up to 120 a week, then a month', () => {
    expect(granularityFor('custom', span(31))).toBe('day')
    expect(granularityFor('custom', span(32))).toBe('week')
    expect(granularityFor('custom', span(120))).toBe('week')
    expect(granularityFor('custom', span(121))).toBe('month')
  })
})
