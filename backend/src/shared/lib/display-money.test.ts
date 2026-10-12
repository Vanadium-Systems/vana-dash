/**
 * Totals in the display currency of the person asking. Integration test on the real database:
 * rows far in the future (2033), so they do not meet real data.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client.js'
import { exchangeRates, financialRecords } from '../db/schema/index.js'
import { displayMoney, moneyMeta } from './display-money.js'
import { getPnlTotals } from './financial-aggregation.js'
import type { DisplayCurrency } from './locale.js'
import type { PeriodRange } from './period.js'
import { runWithFreshActor } from './request-context.js'

const RANGE: PeriodRange = { from: new Date('2033-05-01T00:00:00Z'), to: new Date('2033-05-31T23:59:59Z') }
const recordIds: string[] = []
const rateDates = ['2033-05-04', '2033-05-19']

/** Runs `fn` as a request made by a person with this display currency. */
const asPersonWith = <T>(displayCurrency: DisplayCurrency, fn: () => Promise<T>) =>
  runWithFreshActor({ userId: null, ip: null, displayCurrency }, fn)

beforeAll(async () => {
  await db.insert(exchangeRates).values([
    { date: rateDates[0]!, currency: 'EUR', rate: '5.000000' },
    { date: rateDates[1]!, currency: 'EUR', rate: '4.000000' },
  ])
  const inserted = await db
    .insert(financialRecords)
    .values([
      // 1000 RON on a day when 1 EUR = 5 RON, then 800 RON when 1 EUR = 4 RON.
      { type: 'invoice', direction: 'out', amount: '1000', currency: 'RON', paymentStatus: 'paid', source: 'manual', issuedAt: new Date('2033-05-05T10:00:00Z') },
      { type: 'invoice', direction: 'out', amount: '800', currency: 'RON', paymentStatus: 'paid', source: 'manual', issuedAt: new Date('2033-05-20T10:00:00Z') },
      // An invoice already in EUR keeps its amount when totals are shown in EUR.
      { type: 'invoice', direction: 'out', amount: '100', currency: 'EUR', paymentStatus: 'paid', source: 'manual', issuedAt: new Date('2033-05-20T12:00:00Z') },
      { type: 'expense', direction: 'in', amount: '400', currency: 'RON', paymentStatus: 'paid', source: 'manual', issuedAt: new Date('2033-05-21T10:00:00Z') },
    ])
    .returning({ id: financialRecords.id })
  recordIds.push(...inserted.map((row) => row.id))
})

afterAll(async () => {
  await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
  await db.delete(exchangeRates).where(and(eq(exchangeRates.currency, 'EUR'), inArray(exchangeRates.date, rateDates)))
})

describe('totals in the display currency', () => {
  it('in RON are the figures the books hold', async () => {
    const totals = await asPersonWith('RON', () => getPnlTotals(RANGE))
    // 1000 + 800 + 100 EUR at the rate of its day (4) = 2200
    expect(totals).toEqual({ revenue: 2200, expense: 400, net: 1800 })
    expect(await asPersonWith('RON', moneyMeta)).toEqual({ currency: 'RON', converted: false, rateSource: 'BNR' })
  })

  it('in EUR divide each row by the rate of its own day', async () => {
    const totals = await asPersonWith('EUR', () => getPnlTotals(RANGE))
    // 1000 / 5 + 800 / 4 + 100 (already EUR) = 500; 400 / 4 = 100
    expect(totals.revenue).toBeCloseTo(500, 6)
    expect(totals.expense).toBeCloseTo(100, 6)
    expect(await asPersonWith('EUR', moneyMeta)).toEqual({ currency: 'EUR', converted: true, rateSource: 'BNR' })
  })

  it('without a request, as in a job, use the installation default', async () => {
    expect((await displayMoney()).currency).toBe('RON')
  })
})

describe('a currency with no rate at all', () => {
  const hidden: string[] = []

  // The database is shared with development, which may hold real USD rates: they are set
  // aside for the length of this test and put back.
  beforeAll(async () => {
    const rows = await db
      .update(exchangeRates)
      .set({ deletedAt: new Date() })
      .where(and(eq(exchangeRates.currency, 'USD'), isNull(exchangeRates.deletedAt)))
      .returning({ id: exchangeRates.id })
    hidden.push(...rows.map((row) => row.id))
  })
  afterAll(async () => {
    if (hidden.length > 0) await db.update(exchangeRates).set({ deletedAt: null }).where(inArray(exchangeRates.id, hidden))
  })

  it('stays in RON and says so, instead of treating the missing rate as 1', async () => {
    expect(await asPersonWith('USD', moneyMeta)).toEqual({ currency: 'RON', converted: false, rateSource: 'BNR', fallback: 'no_rate' })
    const totals = await asPersonWith('USD', () => getPnlTotals(RANGE))
    expect(totals).toEqual({ revenue: 2200, expense: 400, net: 1800 })
  })
})
