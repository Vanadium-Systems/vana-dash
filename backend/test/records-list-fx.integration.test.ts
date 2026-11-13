/**
 * The second amount on a list row: the document converted to RON at the BNR rate of its day,
 * or null when no rate is stored (never the 1:1 fallback the aggregates use).
 * XTS / XXX are the ISO codes reserved for tests, so no real rate row is touched.
 */
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanup, makeRecord, RUN } from './invoicing-fixtures.js'
import { db } from '../src/shared/db/client.js'
import { exchangeRates } from '../src/shared/db/schema/index.js'
import { listRecordsPage } from '../src/modules/accounting/records-list.js'

afterAll(async () => {
  await db.delete(exchangeRates).where(eq(exchangeRates.currency, 'XTS'))
  await cleanup()
})

describe('records list: amount in the company currency', () => {
  it('converts at the rate of the document day and leaves null without a rate', async () => {
    await db.insert(exchangeRates).values({ date: '2031-01-01', currency: 'XTS', rate: '4.9750' }).onConflictDoNothing()
    const issuedAt = new Date('2031-02-01T10:00:00Z')
    await makeRecord({ currency: 'XTS', amount: '100.00', issuedAt, counterpartyName: `FX${RUN} rated` })
    await makeRecord({ currency: 'XXX', amount: '100.00', issuedAt, counterpartyName: `FX${RUN} unrated` })
    await makeRecord({ currency: 'RON', amount: '100.00', issuedAt, counterpartyName: `FX${RUN} lei` })

    const page = await listRecordsPage({ q: `FX${RUN}`, direction: 'out', limit: 200 })
    const byName = Object.fromEntries(page.items.map((row) => [row.counterpartyName, row.companyAmount]))
    expect(byName[`FX${RUN} rated`]).toBeCloseTo(497.5, 2)
    expect(byName[`FX${RUN} unrated`]).toBeNull()
    expect(byName[`FX${RUN} lei`]).toBeNull()
  })
})
