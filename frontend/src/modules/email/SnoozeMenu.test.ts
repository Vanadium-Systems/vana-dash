import { describe, expect, it } from 'vitest'
import { snoozeOptions } from './SnoozeMenu'

describe('snoozeOptions', () => {
  it('offers later today only before 17:00', () => {
    const wednesdayMorning = new Date(2026, 9, 28, 10, 0)
    expect(snoozeOptions(wednesdayMorning).map((o) => o.key)).toEqual(['laterToday', 'tomorrow', 'nextWeek'])
    expect(snoozeOptions(new Date(2026, 9, 28, 17, 30)).map((o) => o.key)).toEqual(['tomorrow', 'nextWeek'])
  })

  it('next week is the coming Monday at 08:00, also from a Monday', () => {
    const [, , nextWeek] = snoozeOptions(new Date(2026, 9, 26, 9, 0))
    expect(nextWeek?.at).toEqual(new Date(2026, 10, 2, 8, 0))
    expect(snoozeOptions(new Date(2026, 9, 31, 20, 0))[1]?.at).toEqual(new Date(2026, 10, 2, 8, 0))
  })
})
