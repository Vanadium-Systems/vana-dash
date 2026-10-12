/**
 * modules/accounting/schema.ts — validare cheltuieli recurente (cycle='annual' ⇒ cycleMonth
 * obligatoriu, la fel ca billingClientCycle) + strângerea ManualRecordCreateSchema.currency
 * de la text liber la enum RON|EUR|USD (Sprint cheltuieli recurente/one-time).
 */
import { describe, expect, it } from 'vitest'
import { ManualRecordCreateSchema, RecurringExpenseCreateSchema, RecurringExpenseUpdateSchema } from './schema.js'

describe('ManualRecordCreateSchema', () => {
  it('accepts RON/EUR/USD', () => {
    for (const currency of ['RON', 'EUR', 'USD']) {
      const result = ManualRecordCreateSchema.safeParse({ type: 'expense', amount: 10, currency, issuedAt: '2026-01-01' })
      expect(result.success).toBe(true)
    }
  })

  it('rejects a currency outside RON/EUR/USD — era text liber (3 caractere, orice) înainte', () => {
    const result = ManualRecordCreateSchema.safeParse({ type: 'expense', amount: 10, currency: 'GBP', issuedAt: '2026-01-01' })
    expect(result.success).toBe(false)
  })
})

function validRecurring(overrides: Partial<Record<string, unknown>> = {}) {
  return { description: 'Abonament AWS', amount: 49, currency: 'EUR', cycle: 'monthly', cycleDay: 1, ...overrides }
}

describe('RecurringExpenseCreateSchema', () => {
  it('accepts a monthly expense without cycleMonth', () => {
    expect(RecurringExpenseCreateSchema.safeParse(validRecurring()).success).toBe(true)
  })

  it('accepts an annual expense WITH cycleMonth', () => {
    const result = RecurringExpenseCreateSchema.safeParse(validRecurring({ cycle: 'annual', cycleMonth: 6 }))
    expect(result.success).toBe(true)
  })

  it('rejects an annual expense WITHOUT cycleMonth', () => {
    const result = RecurringExpenseCreateSchema.safeParse(validRecurring({ cycle: 'annual' }))
    expect(result.success).toBe(false)
  })

  it('rejects cycleDay outside 1-31', () => {
    expect(RecurringExpenseCreateSchema.safeParse(validRecurring({ cycleDay: 32 })).success).toBe(false)
    expect(RecurringExpenseCreateSchema.safeParse(validRecurring({ cycleDay: 0 })).success).toBe(false)
  })

  it('rejects a non-positive amount', () => {
    expect(RecurringExpenseCreateSchema.safeParse(validRecurring({ amount: 0 })).success).toBe(false)
    expect(RecurringExpenseCreateSchema.safeParse(validRecurring({ amount: -5 })).success).toBe(false)
  })
})

describe('RecurringExpenseUpdateSchema', () => {
  it('accepts a partial patch touching only `active` (pause), fără celelalte câmpuri', () => {
    expect(RecurringExpenseUpdateSchema.safeParse({ active: false }).success).toBe(true)
  })

  it('rejects switching cycle to annual in the same patch without cycleMonth', () => {
    expect(RecurringExpenseUpdateSchema.safeParse({ cycle: 'annual' }).success).toBe(false)
  })
})
