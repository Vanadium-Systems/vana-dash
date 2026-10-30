import { describe, expect, it } from 'vitest'
import { buildRecurrence, parseRecurrence, recurrenceEndInputValue, recurrenceEndIso } from './recurrence'

const tuesday = new Date(2026, 9, 27, 10, 0)

describe('recurrence', () => {
  it('keeps INTERVAL and the parts the form does not edit', () => {
    const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=7'
    expect(buildRecurrence(parseRecurrence(rule), tuesday)).toBe(rule)
  })

  it('keeps a rule the form cannot show, verbatim', () => {
    for (const rule of ['FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=WEEKLY;BYDAY=1MO', 'FREQ=YEARLY']) {
      const form = parseRecurrence(rule)
      expect(form.type).toBe('custom')
      expect(buildRecurrence(form, tuesday)).toBe(rule)
    }
  })

  it('builds weekly on the start day when no day is picked', () => {
    expect(buildRecurrence({ type: 'weekly', interval: 1, days: [], rest: [], raw: null }, tuesday)).toBe('FREQ=WEEKLY;BYDAY=TU')
  })

  it('orders days and adds the interval', () => {
    expect(buildRecurrence({ type: 'weekly', interval: 3, days: ['FR', 'MO'], rest: [], raw: null }, tuesday)).toBe('FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,FR')
    expect(buildRecurrence({ type: 'daily', interval: 1, days: [], rest: [], raw: null }, tuesday)).toBe('FREQ=DAILY')
  })

  it('ends the series at the end of the chosen day', () => {
    const iso = recurrenceEndIso('2026-12-18')
    expect(new Date(iso).getDate()).toBe(18)
    expect(new Date(iso).getHours()).toBe(23)
    expect(recurrenceEndInputValue(iso)).toBe('2026-12-18')
  })
})
