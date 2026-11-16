import { describe, expect, it, vi } from 'vitest'
import cron, { matchesCron, parseCron, schedule, validate } from './cron.js'

const USED_JOB_EXPRESSIONS = [
  '* * * * *',
  '*/5 * * * *',
  '*/10 * * * *',
  '*/15 * * * *',
  '*/25 * * * *',
  '*/30 * * * *',
  '0 * * * *',
  '15 * * * *',
  '0 3 * * *',
  '15 3 * * *',
  '30 3 * * *',
  '0 4 * * *',
  '10 4 * * *',
  '17 4 * * *',
  '30 4 * * *',
  '0 5 1 * *',
  '0 6 * * *',
  '0 6,14 * * *',
  '30 6 * * *',
  '0 7 * * *',
  '30 7 * * *',
  '0 8 * * *',
  '0 8 1 * *',
  '0 11 * * *',
  '30 11 * * *',
]

describe('cron', () => {
  it('validates all expressions used across backend jobs', () => {
    for (const expr of USED_JOB_EXPRESSIONS) {
      expect(validate(expr)).toBe(true)
      expect(cron.validate(expr)).toBe(true)
    }
  })

  it('rejects invalid cron expressions', () => {
    expect(validate('')).toBe(false)
    expect(validate('* * * *')).toBe(false)
    expect(validate('* * * * * *')).toBe(false)
    expect(validate('60 * * * *')).toBe(false)
    expect(validate('* 24 * * *')).toBe(false)
    expect(validate('* * 0 * *')).toBe(false)
    expect(validate('* * * 13 *')).toBe(false)
    expect(validate('*/0 * * * *')).toBe(false)
    expect(validate('10-5 * * * *')).toBe(false)
    expect(validate('abc * * * *')).toBe(false)
  })

  it('matches step, list, range, and day-of-week 7 as Sunday', () => {
    const every5 = parseCron('*/5 * * * *')!
    expect(matchesCron(every5, new Date('2026-06-15T10:00:00Z'), 'UTC')).toBe(true)
    expect(matchesCron(every5, new Date('2026-06-15T10:05:00Z'), 'UTC')).toBe(true)
    expect(matchesCron(every5, new Date('2026-06-15T10:03:00Z'), 'UTC')).toBe(false)

    const twiceDaily = parseCron('0 6,14 * * *')!
    expect(matchesCron(twiceDaily, new Date('2026-06-15T06:00:00Z'), 'UTC')).toBe(true)
    expect(matchesCron(twiceDaily, new Date('2026-06-15T14:00:00Z'), 'UTC')).toBe(true)
    expect(matchesCron(twiceDaily, new Date('2026-06-15T07:00:00Z'), 'UTC')).toBe(false)

    const range = parseCron('10-12 9-17 * * 1-5')!
    // 2026-06-15 is Monday
    expect(matchesCron(range, new Date('2026-06-15T09:10:00Z'), 'UTC')).toBe(true)
    expect(matchesCron(range, new Date('2026-06-15T09:13:00Z'), 'UTC')).toBe(false)
    // 2026-06-14 is Sunday
    expect(matchesCron(range, new Date('2026-06-14T09:10:00Z'), 'UTC')).toBe(false)

    const sunday7 = parseCron('0 8 * * 7')!
    expect(matchesCron(sunday7, new Date('2026-06-14T08:00:00Z'), 'UTC')).toBe(true)
  })

  it('handles DST transitions in Europe/Bucharest', () => {
    // Spring forward: 2026-03-29 03:00 EET -> 04:00 EEST
    // 03:30 local does not exist; 04:00 EEST is 01:00 UTC
    const at0330 = parseCron('30 3 * * *')!
    expect(matchesCron(at0330, new Date('2026-03-29T00:30:00Z'), 'Europe/Bucharest')).toBe(false) // 02:30 EET
    expect(matchesCron(at0330, new Date('2026-03-29T01:30:00Z'), 'Europe/Bucharest')).toBe(false) // 04:30 EEST

    const at0400 = parseCron('0 4 * * *')!
    expect(matchesCron(at0400, new Date('2026-03-29T01:00:00Z'), 'Europe/Bucharest')).toBe(true) // 04:00 EEST

    // Fall back: 2026-10-25 04:00 EEST -> 03:00 EET
    // 03:15 local occurs at 00:15 UTC (EEST) and 01:15 UTC (EET)
    const at0315 = parseCron('15 3 * * *')!
    expect(matchesCron(at0315, new Date('2026-10-25T00:15:00Z'), 'Europe/Bucharest')).toBe(true)
    expect(matchesCron(at0315, new Date('2026-10-25T01:15:00Z'), 'Europe/Bucharest')).toBe(true)
  })

  it('schedules tasks and stops cleanly with fake timers', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-15T10:00:30Z'))
      const fn = vi.fn()
      const task = schedule('1 * * * *', fn, { timezone: 'UTC' })

      vi.advanceTimersByTime(35_000) // 10:01:05
      expect(fn).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(60_000) // 10:02:05
      expect(fn).toHaveBeenCalledTimes(1)

      task.stop()
      vi.advanceTimersByTime(60 * 60_000)
      expect(fn).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when scheduling an invalid expression', () => {
    expect(() => schedule('invalid', () => {})).toThrow()
  })
})
