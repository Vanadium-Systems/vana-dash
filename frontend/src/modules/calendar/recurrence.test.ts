import roResources from '@/locales/ro'
import enResources from '@/locales/en'
import { initWithResources } from '@/shared/lib/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRecurrence, describeRule, parseRecurrence, recurrenceEndInputValue, recurrenceEndIso } from './recurrence'

const tuesday = new Date(2026, 9, 27, 10, 0)

describe('recurrence', () => {
  it('keeps INTERVAL and the parts the form does not edit', () => {
    const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=7'
    expect(buildRecurrence(parseRecurrence(rule), tuesday)).toBe(rule)
  })

  it('keeps a rule the form cannot show, verbatim', () => {
    for (const rule of ['FREQ=MONTHLY;BYMONTHDAY=15;BYMONTH=3', 'FREQ=WEEKLY;BYDAY=1MO', 'FREQ=MONTHLY;BYDAY=TH;BYSETPOS=2', 'FREQ=MONTHLY;BYDAY=5TH', 'FREQ=YEARLY;BYMONTH=3', 'FREQ=HOURLY']) {
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

  it('round-trips the monthly, yearly and weekday shapes', () => {
    // 2026-10-27 is the fourth Tuesday and the last Tuesday of October.
    const lastTuesday = new Date(2026, 9, 27, 10, 0)
    const secondThursday = new Date(2026, 10, 12, 10, 0)
    const cases: Array<[string, RecurrenceTypeName, Date]> = [
      ['FREQ=MONTHLY;BYMONTHDAY=27', 'monthlyDate', lastTuesday],
      ['FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=27;COUNT=4', 'monthlyDate', lastTuesday],
      ['FREQ=MONTHLY;BYDAY=-1TU', 'monthlyWeekday', lastTuesday],
      ['FREQ=MONTHLY;BYDAY=2TH', 'monthlyWeekday', secondThursday],
      ['FREQ=MONTHLY;INTERVAL=3;BYDAY=2TH;UNTIL=20271231T215959Z', 'monthlyWeekday', secondThursday],
      ['FREQ=YEARLY', 'yearly', lastTuesday],
      ['FREQ=YEARLY;INTERVAL=2', 'yearly', lastTuesday],
      ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'weekdays', lastTuesday],
    ]
    for (const [rule, type, start] of cases) {
      const form = parseRecurrence(rule, start)
      expect(form.type).toBe(type)
      expect(buildRecurrence(form, start)).toBe(rule)
    }
  })

  it('picks the last weekday of the month when the start is in its last 7 days', () => {
    const form = { type: 'monthlyWeekday' as const, interval: 1, days: [], rest: [], raw: null }
    expect(buildRecurrence(form, new Date(2026, 9, 25))).toBe('FREQ=MONTHLY;BYDAY=-1SU')
    expect(buildRecurrence(form, new Date(2026, 9, 24))).toBe('FREQ=MONTHLY;BYDAY=4SA')
    expect(buildRecurrence(form, new Date(2026, 9, 1))).toBe('FREQ=MONTHLY;BYDAY=1TH')
  })

  it('keeps a monthly rule custom when it does not fall on the start', () => {
    expect(parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=15', new Date(2026, 9, 3)).type).toBe('custom')
    expect(parseRecurrence('FREQ=MONTHLY;BYDAY=2TH', new Date(2026, 9, 3)).type).toBe('custom')
  })

  it('does not turn a five-day weekly rule with an interval into weekdays', () => {
    expect(parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR').type).toBe('weekly')
  })
})

type RecurrenceTypeName = ReturnType<typeof parseRecurrence>['type']

describe('describeRule in Romanian', () => {
  const tuesday = new Date(2026, 10, 3, 10, 0)
  const thursday = new Date(2026, 10, 26, 10, 0)

  it.each([
    ['FREQ=DAILY', tuesday, 'Zilnic'],
    ['FREQ=DAILY;INTERVAL=3', tuesday, 'La fiecare 3 zile'],
    ['FREQ=DAILY;INTERVAL=25', tuesday, 'La fiecare 25 de zile'],
    ['FREQ=WEEKLY;BYDAY=TU,TH', tuesday, 'Săptămânal, marți și joi'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', tuesday, 'La fiecare 2 săptămâni, luni'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', tuesday, 'În zilele lucrătoare'],
    ['FREQ=MONTHLY;BYMONTHDAY=15', tuesday, 'Lunar, pe 15'],
    ['FREQ=MONTHLY;BYDAY=4TH', thursday, 'Lunar, în a patra joi'],
    ['FREQ=MONTHLY;BYDAY=-1FR', tuesday, 'Lunar, în ultima vineri'],
    ['FREQ=YEARLY', new Date(2026, 10, 9), 'Anual, pe 9 noiembrie'],
    ['FREQ=WEEKLY;BYDAY=TU;UNTIL=20261220T215959Z', tuesday, 'Săptămânal, marți, până la 20 dec.'],
    ['FREQ=DAILY;COUNT=10', tuesday, 'Zilnic, de 10 ori'],
    ['FREQ=WEEKLY;BYDAY=1MO', tuesday, 'Regulă personalizată'],
  ])('%s', (rule, start, expected) => {
    expect(describeRule(rule, start)).toBe(expected)
  })

  it('takes the end from recurrenceEndAt when given', () => {
    expect(describeRule('FREQ=DAILY', tuesday, new Date(2026, 11, 20))).toBe('Zilnic, până la 20 dec.')
  })

  it('is empty without a rule', () => {
    expect(describeRule(null, tuesday)).toBe('')
  })
})

describe('describeRule in English', () => {
  const tuesday = new Date(2026, 10, 3, 10, 0)
  const thursday = new Date(2026, 10, 26, 10, 0)

  afterEach(() => initWithResources('ro', roResources))

  it('reads naturally', () => {
    initWithResources('en', enResources)
    expect(describeRule('FREQ=WEEKLY;BYDAY=TU,TH', tuesday)).toBe('Weekly on Tuesday and Thursday')
    expect(describeRule('FREQ=MONTHLY;BYDAY=4TH', thursday)).toBe('Monthly on the fourth Thursday')
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', tuesday)).toBe('Every weekday')
    expect(describeRule('FREQ=DAILY;INTERVAL=3', tuesday)).toBe('Every 3 days')
    expect(describeRule('FREQ=DAILY;COUNT=10', tuesday)).toBe('Daily, 10 times')
    expect(describeRule('FREQ=WEEKLY;BYDAY=1MO', tuesday)).toBe('Custom rule')
  })
})
