/**
 * Integration test — pg real (test/setup.ts). Verifică period-comparison (reutilizează
 * getPnlTotals din shared/lib/financial-aggregation.ts) și expense-breakdown-trend
 * (GROUP BY categorie x lună). Perioadă îndepărtată de "azi" ca să nu se ciocnească
 * cu date reale din DB-ul de dev.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { financialRecords } from '../../shared/db/schema/index.js'
import { getExpenseBreakdownTrend, getPeriodComparison, periodComparisonToCsv } from './service.js'

const recordIds: string[] = []

async function seed(rows: Array<Partial<typeof financialRecords.$inferInsert> & { amount: string; issuedAt: Date; direction: 'in' | 'out' }>) {
  const inserted = await db
    .insert(financialRecords)
    .values(
      rows.map((r) => ({
        type: 'invoice' as const,
        currency: 'RON',
        paymentStatus: 'unpaid' as const,
        source: 'manual',
        ...r,
      })),
    )
    .returning({ id: financialRecords.id })
  recordIds.push(...inserted.map((r) => r.id))
}

afterAll(async () => {
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
})

const PERIOD_A = { from: new Date('2032-01-01T00:00:00Z'), to: new Date('2032-01-31T23:59:59Z') }
const PERIOD_B = { from: new Date('2032-02-01T00:00:00Z'), to: new Date('2032-02-28T23:59:59Z') }

describe('getPeriodComparison', () => {
  it('compară venit/cheltuială/net pe două intervale disjuncte', async () => {
    await seed([
      { direction: 'out', amount: '1000', issuedAt: new Date('2032-01-10T00:00:00Z') },
      { direction: 'in', amount: '400', type: 'expense', issuedAt: new Date('2032-01-15T00:00:00Z') },
      { direction: 'out', amount: '2000', issuedAt: new Date('2032-02-10T00:00:00Z') },
      { direction: 'in', amount: '300', type: 'expense', issuedAt: new Date('2032-02-15T00:00:00Z') },
    ])

    const result = await getPeriodComparison({ fromA: PERIOD_A.from, toA: PERIOD_A.to, fromB: PERIOD_B.from, toB: PERIOD_B.to })

    expect(result.periodA).toEqual({ revenue: 1000, expense: 400, net: 600 })
    expect(result.periodB).toEqual({ revenue: 2000, expense: 300, net: 1700 })
  })

  it('exportă CSV cu ambele perioade', async () => {
    const csv = periodComparisonToCsv({
      periodA: { revenue: 1000, expense: 400, net: 600 },
      periodB: { revenue: 2000, expense: 300, net: 1700 },
    })
    expect(csv).toContain('perioada,venit_ron,cheltuiala_ron,net_ron')
    expect(csv).toContain('A,1000,400,600')
    expect(csv).toContain('B,2000,300,1700')
  })
})

describe('getExpenseBreakdownTrend', () => {
  it('grupează cheltuielile pe categorie x lună', async () => {
    await seed([
      { direction: 'in', type: 'expense', category: 'qa-cat-hosting', amount: '111', issuedAt: new Date('2032-01-05T00:00:00Z') },
      { direction: 'in', type: 'expense', category: 'qa-cat-hosting', amount: '22', issuedAt: new Date('2032-01-20T00:00:00Z') },
      { direction: 'in', type: 'expense', category: 'qa-cat-office', amount: '50', issuedAt: new Date('2032-01-08T00:00:00Z') },
      // Venit — nu trebuie să apară în breakdown-ul de cheltuieli.
      { direction: 'out', amount: '999', category: 'qa-cat-hosting', issuedAt: new Date('2032-01-05T00:00:00Z') },
    ])

    const rows = await getExpenseBreakdownTrend({ from: PERIOD_A.from, to: PERIOD_A.to })
    const hosting = rows.find((r) => r.category === 'qa-cat-hosting')
    const office = rows.find((r) => r.category === 'qa-cat-office')

    expect(hosting?.total).toBe(133)
    expect(office?.total).toBe(50)
  })
})
