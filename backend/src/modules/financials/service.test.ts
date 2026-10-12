/**
 * Integration test — pg real (test/setup.ts). getPnl/getCashflow agregă
 * financial_records în SQL (regula CLAUDE.md #9 — nicio agregare în JS).
 *
 * getRecurringRevenue (Sprint C, Track B) mockuiește `shared/lib/bnr.js` — testat
 * exhaustiv separat în bnr.test.ts, aici ne interesează doar contractul de
 * agregare + degradarea grațioasă când BNR e jos (nu trebuie sa arunce mai departe).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { billingClients, exchangeRates, financialRecords, recurringExpenses } from '../../shared/db/schema/index.js'
import type { PeriodRange } from '../../shared/lib/period.js'

const getRateForDateMock = vi.fn()
vi.mock('../../shared/lib/bnr.js', () => ({ getRateForDate: (...args: unknown[]) => getRateForDateMock(...args) }))

const { getCashflow, getExchangeRateHistory, getPnl, getRecurringExpensesMonthly, getRecurringRevenue } = await import('./service.js')

// Perioadă fixă de test, departe de "azi" ca să nu se ciocnească cu date reale
// din DB-ul de dev al lui Stefan.
const RANGE: PeriodRange = { from: new Date('2031-01-01T00:00:00Z'), to: new Date('2031-03-31T23:59:59Z') }
const OUT_OF_RANGE_DATE = new Date('2030-12-15T00:00:00Z') // înainte de `from`

const recordIds: string[] = []

async function seed(rows: Array<Partial<typeof financialRecords.$inferInsert> & { amount: string; issuedAt: Date; direction: 'in' | 'out' }>) {
  const inserted = await db
    .insert(financialRecords)
    .values(
      rows.map((r) => ({
        type: 'invoice' as const,
        paymentStatus: 'unpaid' as const,
        source: 'manual',
        ...r,
      })),
    )
    .returning({ id: financialRecords.id })
  recordIds.push(...inserted.map((r) => r.id))
}

beforeAll(async () => {
  await seed([
    // Ianuarie 2031: venit (out) 1000 RON categorie 'saas', cheltuială (in) 300 RON categorie 'hosting'
    { amount: '1000', direction: 'out', category: 'saas', issuedAt: new Date('2031-01-05T10:00:00Z'), paymentStatus: 'paid' },
    { amount: '300', direction: 'in', category: 'hosting', issuedAt: new Date('2031-01-10T10:00:00Z'), paymentStatus: 'paid' },
    // Februarie 2031: venit (out) 500 RON, categorie 'saas', neplătit
    { amount: '500', direction: 'out', category: 'saas', issuedAt: new Date('2031-02-05T10:00:00Z'), paymentStatus: 'unpaid' },
    // Februarie 2031: cheltuială (in) fără categorie → trebuie să apară drept 'necategorizat'
    { amount: '120', direction: 'in', category: null, issuedAt: new Date('2031-02-20T10:00:00Z'), paymentStatus: 'partial' },
    // În afara intervalului — NU trebuie să apară în rezultate
    { amount: '99999', direction: 'out', category: 'saas', issuedAt: OUT_OF_RANGE_DATE, paymentStatus: 'paid' },
    // Soft-deleted — NU trebuie să apară în rezultate
    { amount: '77777', direction: 'out', category: 'saas', issuedAt: new Date('2031-01-15T10:00:00Z'), paymentStatus: 'paid', deletedAt: new Date() },
  ])
})

afterAll(async () => {
  await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
})

// NOTE (QA finding, vezi Known Issues): `row.month` E un string la runtime (tipul
// `sql<string>` din service.ts e corect ca TIP), dar în formatul textual NATIV al
// Postgres pentru timestamptz — "2026-07-01 00:00:00+00" — NU e ISO 8601 valid
// (spațiu în loc de 'T', "+00" în loc de "Z", fără milisecunde). Verificat direct
// prin app-ul rulat (nu doar prin acest test): `new Date(x)` îl parsează oricum
// în Node/Chrome (parsare non-standard, implementation-defined), dar orice parser
// ISO strict (date-fns parseISO, Zod .datetime()) l-ar respinge. Vezi Known Issues.
function monthKey(month: unknown): string {
  return (month instanceof Date ? month.toISOString() : String(month)).slice(0, 7)
}

describe('getPnl', () => {
  it('sums amounts correctly per month + direction', async () => {
    const { byMonth } = await getPnl(RANGE)
    const jan = byMonth.filter((r) => monthKey(r.month) === '2031-01')
    const feb = byMonth.filter((r) => monthKey(r.month) === '2031-02')

    const janOut = jan.find((r) => r.direction === 'out')
    const janIn = jan.find((r) => r.direction === 'in')
    expect(janOut?.total).toBe(1000)
    expect(janIn?.total).toBe(300)

    const febOut = feb.find((r) => r.direction === 'out')
    const febIn = feb.find((r) => r.direction === 'in')
    expect(febOut?.total).toBe(500)
    expect(febIn?.total).toBe(120)
  })

  it('BUG-QA2 (reparat): `month` e un string ISO 8601 valid, nu formatul text nativ Postgres', async () => {
    const { byMonth } = await getPnl(RANGE)
    expect(byMonth.length).toBeGreaterThan(0)
    const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
    for (const row of byMonth) {
      expect(typeof row.month).toBe('string')
      expect(ISO_8601.test(row.month)).toBe(true)
    }
  })

  it('excludes out-of-range and soft-deleted records from the monthly totals', async () => {
    const { byMonth } = await getPnl(RANGE)
    const total = byMonth.reduce((sum, r) => sum + r.total, 0)
    expect(total).toBe(1000 + 300 + 500 + 120)
    // Dacă 99999 (out-of-range) sau 77777 (soft-deleted) ar fi incluse, suma ar sări mult peste asta.
    expect(total).toBeLessThan(99999)
  })

  it('sums amounts correctly per category + direction + paymentStatus, and maps null category to necategorizat', async () => {
    const { byCategory } = await getPnl(RANGE)
    // 'saas'/'out' apare pe două rânduri acum — unul per paymentStatus (paid 1000 din
    // ianuarie, unpaid 500 din februarie) — grupare necesară ca frontend-ul să poată
    // separa venitul încasat de cel doar facturat, în loc să le adune orbește.
    const saasOutPaid = byCategory.find((r) => r.category === 'saas' && r.direction === 'out' && r.paymentStatus === 'paid')
    const saasOutUnpaid = byCategory.find((r) => r.category === 'saas' && r.direction === 'out' && r.paymentStatus === 'unpaid')
    expect(saasOutPaid?.total).toBe(1000)
    expect(saasOutUnpaid?.total).toBe(500)

    const uncategorized = byCategory.find((r) => r.category === 'necategorizat')
    expect(uncategorized).toBeDefined()
    expect(uncategorized?.direction).toBe('in')
    expect(uncategorized?.total).toBe(120)
    // 'null' literal string nu trebuie să apară niciodată ca valoare de categorie.
    expect(byCategory.some((r) => r.category === null || r.category === 'null')).toBe(false)
  })

  it('returns empty arrays (not a crash) for an interval with zero records', async () => {
    const emptyRange: PeriodRange = { from: new Date('2099-01-01'), to: new Date('2099-01-31') }
    const { byMonth, byCategory } = await getPnl(emptyRange)
    expect(byMonth).toEqual([])
    expect(byCategory).toEqual([])
  })
})

// Bug real: getPnl/getCashflow adunau `amount` direct, indiferent de `currency` — o cheltuială
// EUR amestecată cu una RON s-ar aduna greșit, ca și cum ar fi aceeași monedă. Fixat via
// shared/lib/sql-fx.ts (ronAmountSql) — testat aici prin comportamentul observabil al getPnl,
// nu izolat (fragmentul SQL n-are sens rulat singur, în afara unui query real).
describe('getPnl — conversie valutară (ronAmountSql)', () => {
  const FX_RANGE: PeriodRange = { from: new Date('2032-01-01T00:00:00Z'), to: new Date('2032-01-31T23:59:59Z') }
  const fxRecordIds: string[] = []

  beforeAll(async () => {
    await db.insert(exchangeRates).values({ date: '2032-01-05', currency: 'EUR', rate: '5.000000' })
    const inserted = await db
      .insert(financialRecords)
      .values([
        // Curs disponibil (2032-01-05 ≤ 2032-01-10) — trebuie convertit: 100 EUR * 5.0 = 500 RON.
        {
          type: 'invoice',
          direction: 'out',
          amount: '100',
          currency: 'EUR',
          category: 'fx-eur',
          paymentStatus: 'paid',
          source: 'manual',
          issuedAt: new Date('2032-01-10T10:00:00Z'),
        },
        // RON — trece neschimbat (control, fără subquery).
        {
          type: 'invoice',
          direction: 'out',
          amount: '50',
          currency: 'RON',
          category: 'fx-ron',
          paymentStatus: 'paid',
          source: 'manual',
          issuedAt: new Date('2032-01-10T10:00:00Z'),
        },
      ])
      .returning({ id: financialRecords.id })
    fxRecordIds.push(...inserted.map((r) => r.id))
  })

  afterAll(async () => {
    await db.delete(financialRecords).where(inArray(financialRecords.id, fxRecordIds))
    await db.delete(exchangeRates).where(and(eq(exchangeRates.date, '2032-01-05'), eq(exchangeRates.currency, 'EUR')))
  })

  it('convertește un rând EUR la RON folosind cursul BNR cel mai apropiat ≤ data facturii', async () => {
    const { byCategory } = await getPnl(FX_RANGE)
    const eurRow = byCategory.find((r) => r.category === 'fx-eur')
    expect(eurRow?.total).toBe(500) // 100 EUR * 5.0
  })

  it('lasă un rând RON neschimbat (fără subquery)', async () => {
    const { byCategory } = await getPnl(FX_RANGE)
    const ronRow = byCategory.find((r) => r.category === 'fx-ron')
    expect(ronRow?.total).toBe(50)
  })

  it('degradează la 1:1 dacă nu există niciun curs BNR ≤ data rândului (nu aruncă)', async () => {
    const oldDateRange: PeriodRange = { from: new Date('2019-06-01T00:00:00Z'), to: new Date('2019-06-30T23:59:59Z') }
    const [old] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'out',
        amount: '77',
        currency: 'EUR',
        category: 'fx-no-history',
        paymentStatus: 'paid',
        source: 'manual',
        issuedAt: new Date('2019-06-15T10:00:00Z'),
      })
      .returning({ id: financialRecords.id })
    try {
      const { byCategory } = await getPnl(oldDateRange)
      const row = byCategory.find((r) => r.category === 'fx-no-history')
      expect(row?.total).toBe(77) // fallback 1:1, nu 0 și nu crash
    } finally {
      if (old) await db.delete(financialRecords).where(eq(financialRecords.id, old.id))
    }
  })
})

describe('getCashflow', () => {
  it('groups by direction + paymentStatus with correct totals and counts', async () => {
    const rows = await getCashflow(RANGE)

    const outPaid = rows.find((r) => r.direction === 'out' && r.paymentStatus === 'paid')
    expect(outPaid?.total).toBe(1000)
    expect(outPaid?.count).toBe(1)

    const outUnpaid = rows.find((r) => r.direction === 'out' && r.paymentStatus === 'unpaid')
    expect(outUnpaid?.total).toBe(500)
    expect(outUnpaid?.count).toBe(1)

    const inPaid = rows.find((r) => r.direction === 'in' && r.paymentStatus === 'paid')
    expect(inPaid?.total).toBe(300)

    const inPartial = rows.find((r) => r.direction === 'in' && r.paymentStatus === 'partial')
    expect(inPartial?.total).toBe(120)
  })

  it('returns an empty array for an interval with zero records', async () => {
    const emptyRange: PeriodRange = { from: new Date('2099-01-01'), to: new Date('2099-01-31') }
    expect(await getCashflow(emptyRange)).toEqual([])
  })
})

describe('getRecurringRevenue', () => {
  const clientIds: string[] = []

  async function makeClient(overrides: Partial<typeof billingClients.$inferInsert>) {
    const [row] = await db
      .insert(billingClients)
      .values({
        name: 'MRR QA Client',
        cif: `RO${Math.floor(Math.random() * 1e8)}`,
        address: 'x',
        autoInvoiceEnabled: true,
        billingCycle: 'monthly', // majoritatea fixture-urilor de mai jos vizează clienți recurenți lunar
        ...overrides,
      })
      .returning()
    clientIds.push(row!.id)
    return row!
  }

  afterEach(async () => {
    if (clientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, clientIds.splice(0)))
    getRateForDateMock.mockReset()
  })

  it('returns zero for both currencies when there are no auto-invoice-enabled clients', async () => {
    expect(await getRecurringRevenue()).toEqual({ mrrLei: 0, mrrEur: 0 })
    expect(getRateForDateMock).not.toHaveBeenCalled() // nu ar trebui să bată la BNR fără clienți EUR
  })

  it('sums lei-only clients in SQL without touching BNR', async () => {
    await makeClient({ subscriptionPriceLei: '100.00', subscriptionPriceCurrency: 'lei' })
    await makeClient({ subscriptionPriceLei: '250.50', subscriptionPriceCurrency: 'lei' })

    const result = await getRecurringRevenue()
    expect(result.mrrLei).toBe(350.5)
    expect(result.mrrEur).toBe(0)
    expect(getRateForDateMock).not.toHaveBeenCalled()
  })

  it('converts eur clients to lei at the BNR rate of today and adds them to mrrLei', async () => {
    getRateForDateMock.mockResolvedValue({ date: '2026-07-16', currency: 'EUR', rate: '5.000000' })
    await makeClient({ subscriptionPriceEur: '20.00', subscriptionPriceCurrency: 'eur' })

    const result = await getRecurringRevenue()
    expect(result.mrrEur).toBe(20)
    expect(result.mrrLei).toBe(100) // 20 EUR * 5.0
  })

  it('mixes lei + eur clients correctly (lei stays as-is, eur gets converted and added)', async () => {
    getRateForDateMock.mockResolvedValue({ date: '2026-07-16', currency: 'EUR', rate: '5.000000' })
    await makeClient({ subscriptionPriceLei: '100.00', subscriptionPriceCurrency: 'lei' })
    await makeClient({ subscriptionPriceEur: '10.00', subscriptionPriceCurrency: 'eur' })

    const result = await getRecurringRevenue()
    expect(result.mrrEur).toBe(10)
    expect(result.mrrLei).toBe(150) // 100 lei + (10 EUR * 5.0)
  })

  it('ignores clients with autoInvoiceEnabled:false', async () => {
    await makeClient({ subscriptionPriceLei: '999.00', subscriptionPriceCurrency: 'lei', autoInvoiceEnabled: false })
    expect(await getRecurringRevenue()).toEqual({ mrrLei: 0, mrrEur: 0 })
  })

  it('ignores soft-deleted clients', async () => {
    await makeClient({ subscriptionPriceLei: '999.00', subscriptionPriceCurrency: 'lei', deletedAt: new Date() })
    expect(await getRecurringRevenue()).toEqual({ mrrLei: 0, mrrEur: 0 })
  })

  it('CRITICAL — graceful degradation: when BNR is down, still returns the lei-only MRR instead of throwing (dashboard must not crash)', async () => {
    getRateForDateMock.mockRejectedValue(new Error('BNR feed unreachable'))
    await makeClient({ subscriptionPriceLei: '100.00', subscriptionPriceCurrency: 'lei' })
    await makeClient({ subscriptionPriceEur: '50.00', subscriptionPriceCurrency: 'eur' })

    const result = await getRecurringRevenue()
    expect(result.mrrLei).toBe(100) // partea lei rămâne, EUR->lei nu s-a putut converti
    expect(result.mrrEur).toBe(50) // suma EUR brută tot se raportează, doar conversia lipsește
  })

  it('BUG-QA-MRR-1 fixat: an eur client with subscriptionPriceEur set to 0 does not trigger a BNR call', async () => {
    await makeClient({ subscriptionPriceEur: '0.00', subscriptionPriceCurrency: 'eur' })
    // Fixat: filtrul compară `Number(r.eur) > 0`, nu `r.eur` direct — "0.00" (string) nu
    // mai e tratat ca truthy, deci acest client e exclus din eurRows, zero fetch BNR.
    getRateForDateMock.mockResolvedValue({ date: '2026-07-16', currency: 'EUR', rate: '5.000000' })
    const result = await getRecurringRevenue()
    expect(result.mrrEur).toBe(0)
    expect(getRateForDateMock).not.toHaveBeenCalled()
  })

  it('normalizes an annual-billing client to its monthly contribution (price/12), not the full annual amount', async () => {
    await makeClient({ subscriptionPriceLei: '1200.00', subscriptionPriceCurrency: 'lei', billingCycle: 'annual' })
    const result = await getRecurringRevenue()
    expect(result.mrrLei).toBe(100) // 1200/12, nu 1200
  })

  it('normalizes an annual eur client before applying the BNR rate (division happens first)', async () => {
    getRateForDateMock.mockResolvedValue({ date: '2026-07-16', currency: 'EUR', rate: '5.000000' })
    await makeClient({ subscriptionPriceEur: '240.00', subscriptionPriceCurrency: 'eur', billingCycle: 'annual' })
    const result = await getRecurringRevenue()
    expect(result.mrrEur).toBe(20) // 240/12
    expect(result.mrrLei).toBe(100) // 20 * 5.0
  })

  it('excludes one-shot clients (billingCycle: null) entirely from MRR, even when autoInvoiceEnabled', async () => {
    await makeClient({ subscriptionPriceLei: '999.00', subscriptionPriceCurrency: 'lei', billingCycle: null })
    expect(await getRecurringRevenue()).toEqual({ mrrLei: 0, mrrEur: 0 })
  })

  it('mixes monthly + annual + one-shot clients: only monthly (full) + annual (/12) are summed', async () => {
    await makeClient({ subscriptionPriceLei: '100.00', subscriptionPriceCurrency: 'lei', billingCycle: 'monthly' })
    await makeClient({ subscriptionPriceLei: '1200.00', subscriptionPriceCurrency: 'lei', billingCycle: 'annual' })
    await makeClient({ subscriptionPriceLei: '999.00', subscriptionPriceCurrency: 'lei', billingCycle: null })

    const result = await getRecurringRevenue()
    expect(result.mrrLei).toBe(200) // 100 + (1200/12), fără cei 999 one-shot
  })
})

// Calculat LIVE din recurring_expenses, NU din financial_records — bug semnalat de Stefan:
// o cheltuială recurentă abia creată n-are încă niciun rând materializat (cron scrie unul doar
// la nextDueDate), deci "Cheltuieli, în așteptare" (bazat pe financial_records) arăta 0 deși
// existau 3 cheltuieli recurente active.
describe('getRecurringExpensesMonthly', () => {
  const expenseIds: string[] = []

  async function makeExpense(overrides: Partial<typeof recurringExpenses.$inferInsert>) {
    const [row] = await db
      .insert(recurringExpenses)
      .values({ description: 'QA recurring expense', amount: '1', currency: 'RON', cycle: 'monthly', cycleDay: 1, nextDueDate: '2099-01-01', active: true, ...overrides })
      .returning()
    expenseIds.push(row!.id)
    return row!
  }

  afterEach(async () => {
    if (expenseIds.length) await db.delete(recurringExpenses).where(inArray(recurringExpenses.id, expenseIds.splice(0)))
    getRateForDateMock.mockReset()
  })

  it('returns 0 when there are no active recurring expenses', async () => {
    expect(await getRecurringExpensesMonthly()).toEqual({ monthlyRon: 0 })
    expect(getRateForDateMock).not.toHaveBeenCalled()
  })

  it('sums RON-only monthly expenses without touching BNR', async () => {
    await makeExpense({ amount: '49.00', currency: 'RON', cycle: 'monthly' })
    await makeExpense({ amount: '20.50', currency: 'RON', cycle: 'monthly' })
    const result = await getRecurringExpensesMonthly()
    expect(result.monthlyRon).toBe(69.5)
    expect(getRateForDateMock).not.toHaveBeenCalled()
  })

  it('normalizes an annual expense to its monthly equivalent (amount / 12)', async () => {
    await makeExpense({ amount: '1200.00', currency: 'RON', cycle: 'annual', cycleMonth: 6 })
    const result = await getRecurringExpensesMonthly()
    expect(result.monthlyRon).toBe(100) // 1200 / 12
  })

  it('converts an EUR expense to RON at the BNR rate of today', async () => {
    getRateForDateMock.mockResolvedValue({ date: '2026-07-16', currency: 'EUR', rate: '5.000000' })
    await makeExpense({ amount: '49.00', currency: 'EUR', cycle: 'monthly' })
    const result = await getRecurringExpensesMonthly()
    expect(result.monthlyRon).toBe(245) // 49 * 5.0
  })

  it('ignores inactive (paused) recurring expenses', async () => {
    await makeExpense({ amount: '999.00', currency: 'RON', cycle: 'monthly', active: false })
    expect(await getRecurringExpensesMonthly()).toEqual({ monthlyRon: 0 })
  })

  it('ignores soft-deleted recurring expenses', async () => {
    await makeExpense({ amount: '999.00', currency: 'RON', cycle: 'monthly', deletedAt: new Date() })
    expect(await getRecurringExpensesMonthly()).toEqual({ monthlyRon: 0 })
  })

  it('CRITICAL — graceful degradation: BNR down still returns the RON-only total instead of throwing', async () => {
    getRateForDateMock.mockRejectedValue(new Error('BNR feed unreachable'))
    await makeExpense({ amount: '100.00', currency: 'RON', cycle: 'monthly' })
    await makeExpense({ amount: '50.00', currency: 'EUR', cycle: 'monthly' })
    const result = await getRecurringExpensesMonthly()
    expect(result.monthlyRon).toBe(100) // partea RON rămâne, EUR nu s-a putut converti
  })
})

describe('getExchangeRateHistory (Sprint D, Track 2)', () => {
  // An îndepărtat (2031), ca la restul fișierului, ca să nu se ciocnească cu date reale.
  const ROWS = [
    { date: '2031-01-05', currency: 'EUR', rate: '4.900000' },
    { date: '2031-01-20', currency: 'EUR', rate: '5.100000' },
    { date: '2031-02-10', currency: 'EUR', rate: '5.000000' },
    { date: '2031-01-05', currency: 'USD', rate: '4.500000' },
  ]

  beforeAll(async () => {
    await db.insert(exchangeRates).values(ROWS)
  })

  afterAll(async () => {
    await db.delete(exchangeRates).where(and(eq(exchangeRates.currency, 'EUR'), inArray(exchangeRates.date, ['2031-01-05', '2031-01-20', '2031-02-10'])))
    await db.delete(exchangeRates).where(and(eq(exchangeRates.currency, 'USD'), eq(exchangeRates.date, '2031-01-05')))
  })

  it('daily: returns raw rows for the requested currency, ordered by date, filtered by from/to', async () => {
    const rows = await getExchangeRateHistory({ currency: 'EUR', period: 'daily', from: '2031-01-01', to: '2031-01-31' })
    expect(rows).toEqual([
      { date: '2031-01-05', rate: '4.900000' },
      { date: '2031-01-20', rate: '5.100000' },
    ])
  })

  it('daily: does not mix currencies', async () => {
    const rows = await getExchangeRateHistory({ currency: 'USD', period: 'daily', from: '2031-01-01', to: '2031-01-31' })
    expect(rows).toEqual([{ date: '2031-01-05', rate: '4.500000' }])
  })

  it('monthly: aggregates with AVG in SQL, grouped by month', async () => {
    const rows = await getExchangeRateHistory({ currency: 'EUR', period: 'monthly', from: '2031-01-01', to: '2031-02-28' })
    expect(rows).toEqual([
      { date: '2031-01-01', rate: '5.000000' }, // AVG(4.9, 5.1)
      { date: '2031-02-01', rate: '5.000000' },
    ])
  })

  it('yearly: aggregates with AVG in SQL, grouped by year', async () => {
    const rows = await getExchangeRateHistory({ currency: 'EUR', period: 'yearly', from: '2031-01-01', to: '2031-12-31' })
    expect(rows).toEqual([{ date: '2031-01-01', rate: '5.000000' }]) // AVG(4.9, 5.1, 5.0)
  })

  it('returns an empty array (not a crash) when nothing matches', async () => {
    expect(await getExchangeRateHistory({ currency: 'EUR', period: 'daily', from: '2099-01-01', to: '2099-01-31' })).toEqual([])
  })
})
