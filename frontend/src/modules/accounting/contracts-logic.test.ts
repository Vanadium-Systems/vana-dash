import { describe, expect, it } from 'vitest'
import { daysBetween, EMPTY_TERMS, NEXT_STATUSES, noticeState, termsBody, validateTerms } from './contracts-logic'

describe('noticeState', () => {
  it('warns inside the 30-day window and after the deadline, only for a running contract', () => {
    expect(noticeState('signed', '2026-12-10', '2026-11-24')).toEqual({ kind: 'soon', days: 16 })
    expect(noticeState('signed', '2026-11-24', '2026-11-24')).toEqual({ kind: 'soon', days: 0 })
    expect(noticeState('signed', '2026-11-20', '2026-11-24')).toEqual({ kind: 'overdue' })
    expect(noticeState('signed', '2027-02-01', '2026-11-24')).toBeNull()
    expect(noticeState('terminated', '2026-12-10', '2026-11-24')).toBeNull()
    expect(noticeState('signed', null, '2026-11-24')).toBeNull()
  })

  it('counts days across a month and a year end', () => {
    expect(daysBetween('2026-12-20', '2027-01-05')).toBe(16)
  })
})

describe('NEXT_STATUSES', () => {
  it('lets a terminated contract go nowhere and a signed one only expire or end', () => {
    expect(NEXT_STATUSES.terminated).toEqual([])
    expect(NEXT_STATUSES.signed).toEqual(['expired', 'terminated'])
  })
})

describe('validateTerms', () => {
  it('accepts empty terms', () => {
    expect(validateTerms(EMPTY_TERMS)).toEqual({})
  })

  it('wants months with auto-renewal, an end with a notice, and an end after the start', () => {
    expect(validateTerms({ ...EMPTY_TERMS, autoRenew: true }).renewalMonths).toBeDefined()
    expect(validateTerms({ ...EMPTY_TERMS, noticeDays: '30' }).noticeDays).toBeDefined()
    expect(validateTerms({ ...EMPTY_TERMS, startsOn: '2026-05-01', endsOn: '2026-04-01' }).endsOn).toBeDefined()
    expect(validateTerms({ ...EMPTY_TERMS, endsOn: '2027-01-01', noticeDays: '30', autoRenew: true, renewalMonths: '12' })).toEqual({})
  })

  it('rejects junk in the number fields', () => {
    expect(validateTerms({ ...EMPTY_TERMS, endsOn: '2027-01-01', noticeDays: 'abc' }).noticeDays).toBeDefined()
    expect(validateTerms({ ...EMPTY_TERMS, autoRenew: true, renewalMonths: '0' }).renewalMonths).toBeDefined()
  })
})

describe('termsBody', () => {
  it('sends numbers and nulls, and drops the months when there is no auto-renewal', () => {
    expect(termsBody({ startsOn: '2026-01-01', endsOn: '', autoRenew: false, renewalMonths: '12', noticeDays: '' })).toEqual({
      startsOn: '2026-01-01',
      endsOn: null,
      autoRenew: false,
      renewalMonths: null,
      noticeDays: null,
    })
    expect(termsBody({ ...EMPTY_TERMS, endsOn: '2027-01-01', autoRenew: true, renewalMonths: '12', noticeDays: '60' })).toMatchObject({ renewalMonths: 12, noticeDays: 60 })
  })
})
