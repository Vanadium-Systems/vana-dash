import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildPayload,
  duePresetOf,
  emptyForm,
  evaluateLine,
  evaluateLines,
  missingOf,
  toCents,
  totalsOf,
  type LineDraft,
} from './invoice-editor-logic'

const line = (over: Partial<LineDraft> = {}): LineDraft => ({ description: 'Hosting', quantity: '2', price: '250', priceCurrency: '', vatRate: '19', ...over })

describe('toCents', () => {
  it('rounds half up and does not drift on binary fractions', () => {
    expect(toCents(1.005)).toBe(101)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(19.99)).toBe(1999)
  })
})

describe('evaluateLine', () => {
  it('computes net, VAT and gross in cents', () => {
    const state = evaluateLine(line(), 'RON', {})
    expect(state).toMatchObject({ kind: 'ok', amounts: { netCents: 50000, vatCents: 9500, grossCents: 59500 } })
  })
  it('accepts a Romanian decimal comma', () => {
    const state = evaluateLine(line({ quantity: '1,5', price: '10,10' }), 'RON', {})
    expect(state).toMatchObject({ kind: 'ok', amounts: { netCents: 1515 } })
  })
  it('rounds the VAT half up per line', () => {
    const state = evaluateLine(line({ quantity: '1', price: '0,10', vatRate: '19' }), 'RON', {})
    expect(state).toMatchObject({ kind: 'ok', amounts: { vatCents: 2 } })
  })
  it('is incomplete without a description, a positive quantity or a price', () => {
    expect(evaluateLine(line({ description: '  ' }), 'RON', {}).kind).toBe('incomplete')
    expect(evaluateLine(line({ quantity: '0' }), 'RON', {}).kind).toBe('incomplete')
    expect(evaluateLine(line({ price: '' }), 'RON', {}).kind).toBe('incomplete')
    expect(evaluateLine(line({ vatRate: '101' }), 'RON', {}).kind).toBe('incomplete')
  })
  it('a zero price is valid', () => {
    expect(evaluateLine(line({ price: '0' }), 'RON', {}).kind).toBe('ok')
  })
  it('waits for the rate of a foreign price, then converts it', () => {
    const foreign = line({ price: '200', priceCurrency: 'EUR', quantity: '1', vatRate: '0' })
    expect(evaluateLine(foreign, 'RON', {}).kind).toBe('pending')
    expect(evaluateLine(foreign, 'RON', { EUR: 5.0123 })).toMatchObject({ kind: 'ok', line: { unitPrice: 1002.46 } })
  })
  it('ignores the foreign currency when it equals the document currency', () => {
    expect(evaluateLine(line({ priceCurrency: 'EUR' }), 'EUR', {}).kind).toBe('ok')
  })
})

describe('missingOf and totalsOf', () => {
  const form = { ...emptyForm('RON', '2026-11-13'), billingClientId: 'c1', lines: [line(), line({ price: '10', quantity: '1', vatRate: '0' })] }
  it('a complete form misses nothing and sums the lines', () => {
    const states = evaluateLines(form.lines, 'RON', {})
    expect(missingOf(form, states, false)).toEqual([])
    expect(totalsOf(states)).toEqual({ netCents: 51000, vatCents: 9500, grossCents: 60500 })
  })
  it('names the client first, then the lines', () => {
    const empty = emptyForm('RON', '2026-11-13')
    expect(missingOf(empty, evaluateLines(empty.lines, 'RON', {}), false)).toEqual(['client', 'line'])
  })
  it('a pending rate is reported only when no line is incomplete', () => {
    const f = { ...form, lines: [line({ priceCurrency: 'USD' })] }
    expect(missingOf(f, evaluateLines(f.lines, 'RON', {}), false)).toEqual(['rate'])
  })
  it('a storno draft only needs its issue date', () => {
    const f = { ...emptyForm('RON', '2026-11-13'), lines: [] }
    expect(missingOf(f, [], true)).toEqual([])
    expect(missingOf({ ...f, issuedAt: '' }, [], true)).toEqual(['line'])
  })
})

describe('buildPayload', () => {
  const form = { ...emptyForm('RON', '2026-11-13'), billingClientId: 'c1', dueAt: '2026-12-13', note: 'x', lines: [line({ price: '200', priceCurrency: 'EUR', quantity: '1', vatRate: '0' })] }
  it('sends converted unit prices rounded to 2 decimals', () => {
    const payload = buildPayload(form, evaluateLines(form.lines, 'RON', { EUR: 4.9776 }), false)
    expect(payload.lines).toEqual([{ description: 'Hosting', quantity: 1, unitPrice: 995.52, vatRate: 0 }])
    expect(payload).toMatchObject({ billingClientId: 'c1', currency: 'RON', issuedAt: '2026-11-13', dueAt: '2026-12-13', note: 'x' })
  })
  it('a storno draft sends only note and dates', () => {
    expect(buildPayload(form, [], true)).toEqual({ issuedAt: '2026-11-13', dueAt: '2026-12-13', note: 'x' })
  })
})

describe('due dates', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-11-13', 30)).toBe('2026-12-13')
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02')
  })
  it('recognises a preset, a custom date and an empty one', () => {
    expect(duePresetOf('2026-11-13', '2026-12-13')).toBe(30)
    expect(duePresetOf('2026-11-13', '2026-11-20')).toBe(7)
    expect(duePresetOf('2026-11-13', '2026-11-25')).toBe('custom')
    expect(duePresetOf('2026-11-13', '')).toBeNull()
  })
})
