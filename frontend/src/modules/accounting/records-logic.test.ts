import { describe, expect, it } from 'vitest'
import { canRecordPayment, daysOverdue, paymentConsequence, statusFor } from './records-logic'

describe('daysOverdue', () => {
  it('counts whole days past the due date', () => {
    expect(daysOverdue('2026-10-20T09:00:00Z', '2026-11-02')).toBe(13)
  })
  it('is zero on the due day and before it', () => {
    expect(daysOverdue('2026-11-02T09:00:00Z', '2026-11-02')).toBe(0)
    expect(daysOverdue('2026-11-10T09:00:00Z', '2026-11-02')).toBe(0)
    expect(daysOverdue(null)).toBe(0)
  })
})

describe('paymentConsequence', () => {
  it('a part of the amount leaves a rest and makes the invoice partial', () => {
    expect(paymentConsequence({ amount: 1190, remaining: 1190, typed: 790 })).toEqual({ next: 'partial', rest: 400 })
  })
  it('the whole rest settles it', () => {
    expect(paymentConsequence({ amount: 1190, remaining: 400, typed: 400 })).toEqual({ next: 'paid', rest: 0 })
  })
  it('ignores empty and non-positive input', () => {
    expect(paymentConsequence({ amount: 100, remaining: 100, typed: Number.NaN })).toBeNull()
    expect(paymentConsequence({ amount: 100, remaining: 100, typed: 0 })).toBeNull()
  })
  it('does not drift on cents', () => {
    expect(paymentConsequence({ amount: 0.3, remaining: 0.3, typed: 0.1 })?.rest).toBe(0.2)
  })
})

describe('statusFor and canRecordPayment', () => {
  it('maps rest to state', () => {
    expect(statusFor(0, 10)).toBe('paid')
    expect(statusFor(10, 10)).toBe('unpaid')
    expect(statusFor(4, 10)).toBe('partial')
  })
  it('refuses drafts and settled documents', () => {
    expect(canRecordPayment({ isDraft: true, remaining: 10 })).toBe(false)
    expect(canRecordPayment({ isDraft: false, remaining: 0 })).toBe(false)
    expect(canRecordPayment({ isDraft: false, remaining: 5 })).toBe(true)
  })
})
