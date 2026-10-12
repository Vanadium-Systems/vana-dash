/**
 * modules/accounting/service.ts — cheltuieli recurente (recurring_expenses → financial_records).
 * Integration test, pg real (test/setup.ts). Verifică: calculul inițial de nextDueDate
 * (computeNextOccurrence, reutilizat din shared/lib/billing-cycle.ts), idempotența materializării
 * (jobs/recurring-expenses.ts nu trebuie să dubleze o scadență la rulări repetate), și rollover-ul
 * corect al nextDueDate după materializare.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { billingClients, financialRecords, recurringExpenses } from '../../shared/db/schema/index.js'
import * as service from './service.js'

const expenseIds: string[] = []
const recordIds: string[] = []
const billingClientIds: string[] = []

afterAll(async () => {
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
  if (expenseIds.length) await db.delete(recurringExpenses).where(inArray(recurringExpenses.id, expenseIds))
  if (billingClientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, billingClientIds))
})

function track<T extends { id: string }>(row: T | undefined, into: string[]): T {
  if (!row) throw new Error('expected a row back from insert/update')
  into.push(row.id)
  return row
}

describe('createRecurringExpense — calculul inițial de nextDueDate', () => {
  // Matematica de dată (this-month vs. next-month) e deja testată exhaustiv în
  // shared/lib/billing-cycle.test.ts (computeNextOccurrence) — aici verificăm doar că
  // createRecurringExpense o cablează corect (cycleDay ajunge în nextDueDate calculat, nu ignorat).
  it('monthly — nextDueDate calculat respectă cycleDay, azi sau în viitor', async () => {
    const row = track(
      await service.createRecurringExpense({ description: 'Test lunar', amount: 10, currency: 'RON', cycle: 'monthly', cycleDay: 15, showInCalendar: true, reverseChargeType: 'none', autoMaterialize: true }),
      expenseIds,
    )
    expect(row.nextDueDate.slice(8, 10)).toBe('15')
    expect(new Date(`${row.nextDueDate}T00:00:00Z`).getTime()).toBeGreaterThanOrEqual(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
    )
  })

  it('annual — folosește cycleMonth/cycleDay, nu doar cycleDay', async () => {
    const row = track(
      await service.createRecurringExpense({ description: 'Test anual', amount: 100, currency: 'EUR', cycle: 'annual', cycleDay: 15, cycleMonth: 6, showInCalendar: true, reverseChargeType: 'none', autoMaterialize: true }),
      expenseIds,
    )
    expect(row.nextDueDate.slice(5, 10)).toBe('06-15')
  })
})

describe('updateRecurringExpense', () => {
  it('un patch parțial (doar `active`) nu atinge celelalte câmpuri', async () => {
    const created = track(
      await service.createRecurringExpense({ description: 'Pauzabil', amount: 20, currency: 'RON', cycle: 'monthly', cycleDay: 1, showInCalendar: true, reverseChargeType: 'none', autoMaterialize: true }),
      expenseIds,
    )
    const updated = await service.updateRecurringExpense(created.id, { active: false })
    expect(updated?.active).toBe(false)
    expect(updated?.description).toBe('Pauzabil')
    expect(updated?.amount).toBe(created.amount)
  })

  it('returnează null pt. un id inexistent/șters', async () => {
    expect(await service.updateRecurringExpense('00000000-0000-0000-0000-000000000000', { active: false })).toBeNull()
  })
})

describe('deleteRecurringExpense', () => {
  it('soft delete — nu mai apare în listRecurringExpenses', async () => {
    const created = track(
      await service.createRecurringExpense({ description: 'De șters', amount: 5, currency: 'RON', cycle: 'monthly', cycleDay: 1, showInCalendar: true, reverseChargeType: 'none', autoMaterialize: true }),
      expenseIds,
    )
    await service.deleteRecurringExpense(created.id)
    const list = await service.listRecurringExpenses()
    expect(list.some((e) => e.id === created.id)).toBe(false)
  })
})

describe('listDueRecurringExpenses', () => {
  it('include doar active + scadente azi-sau-mai-devreme, exclude inactive/viitoare', async () => {
    const todayIso = new Date().toISOString().slice(0, 10)
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const due = track(await makeRaw({ description: 'Due', nextDueDate: past }), expenseIds)
    const notDueYet = track(await makeRaw({ description: 'NotDueYet', nextDueDate: future }), expenseIds)
    const paused = track(await makeRaw({ description: 'Paused', nextDueDate: past, active: false }), expenseIds)

    const dueList = await service.listDueRecurringExpenses(todayIso)
    const dueIds = dueList.map((e) => e.id)
    expect(dueIds).toContain(due.id)
    expect(dueIds).not.toContain(notDueYet.id)
    expect(dueIds).not.toContain(paused.id)
  })
})

describe('materializeRecurringExpense + hasExpenseMaterializedForDate — idempotență', () => {
  it('creează un financial_record cu source/meta corecte, și a doua materializare pt. aceeași dată e detectată', async () => {
    const expense = track(
      await service.createRecurringExpense({ description: 'Idempotent test', amount: 33.5, currency: 'EUR', cycle: 'monthly', cycleDay: 1, showInCalendar: true, reverseChargeType: 'none', autoMaterialize: true }),
      expenseIds,
    )
    const dueDateIso = new Date().toISOString().slice(0, 10)

    expect(await service.hasExpenseMaterializedForDate(expense.id, dueDateIso)).toBe(false)

    const record = track(await service.materializeRecurringExpense(expense, dueDateIso), recordIds)
    expect(record?.direction).toBe('in')
    expect(record?.type).toBe('expense')
    expect(record?.source).toBe('recurring_expense')
    expect(record?.currency).toBe('EUR')
    expect(Number(record?.amount)).toBe(33.5)
    expect(record?.paymentStatus).toBe('unpaid')

    expect(await service.hasExpenseMaterializedForDate(expense.id, dueDateIso)).toBe(true)

    // O dată DIFERITĂ nu trebuie să fie confundată cu cea deja materializată.
    const otherDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(await service.hasExpenseMaterializedForDate(expense.id, otherDate)).toBe(false)
  })
})

describe('rollRecurringExpenseNextDueDate', () => {
  it('monthly — avansează la aceeași zi din luna următoare', async () => {
    const expense = track(
      await service.createRecurringExpense({ description: 'Roll monthly', amount: 1, currency: 'RON', cycle: 'monthly', cycleDay: 10, showInCalendar: true, reverseChargeType: 'none', autoMaterialize: true }),
      expenseIds,
    )
    await service.rollRecurringExpenseNextDueDate(expense.id, expense.nextDueDate)
    const [row] = await db.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, expense.id), isNull(recurringExpenses.deletedAt)))
    expect(row?.nextDueDate).not.toBe(expense.nextDueDate)
    expect(row?.nextDueDate.slice(8, 10)).toBe('10')
  })

  it('annual — avansează la anul următor, păstrează luna/ziua', async () => {
    const expense = track(
      await service.createRecurringExpense({ description: 'Roll annual', amount: 1, currency: 'RON', cycle: 'annual', cycleDay: 20, cycleMonth: 3, showInCalendar: true, reverseChargeType: 'none', autoMaterialize: true }),
      expenseIds,
    )
    await service.rollRecurringExpenseNextDueDate(expense.id, expense.nextDueDate)
    const [row] = await db.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, expense.id), isNull(recurringExpenses.deletedAt)))
    expect(row?.nextDueDate.slice(5, 10)).toBe('03-20')
    expect(Number(row?.nextDueDate.slice(0, 4))).toBe(Number(expense.nextDueDate.slice(0, 4)) + 1)
  })
})

/** Insert direct — pt. teste care au nevoie de un `nextDueDate`/`active` arbitrar, nu de calculul din createRecurringExpense. */
async function makeRaw(overrides: Partial<typeof recurringExpenses.$inferInsert>) {
  const [row] = await db
    .insert(recurringExpenses)
    .values({ description: 'Raw', amount: '1', currency: 'RON', cycle: 'monthly', cycleDay: 1, nextDueDate: '2026-01-01', ...overrides })
    .returning()
  return row!
}

describe('updatePayment — rostogolire billingDueDate la plată confirmată', () => {
  // Bug real (Stefan, 2026-08-01): a emis + plătit factura de azi a unui client, dar
  // "Scadență curentă" rămânea neschimbată — jobs/billing-cycle-rollover.ts rulează o
  // singură dată/zi și rostogolește DOAR a doua zi (daysUntilDue < 0), intenționat. Plata
  // confirmată trebuie să rostogolească imediat, nu să aștepte cronul de mâine.
  it('marcarea ca plătită rostogolește billingDueDate-ul clientului la următorul ciclu', async () => {
    const [clientRow] = await db
      .insert(billingClients)
      .values({
        name: 'Client Test Rollover',
        cif: '99999999',
        address: 'Str. Test 1',
        billingCycle: 'monthly',
        billingCycleDay: 1,
        billingDueDate: '2026-08-01',
      })
      .returning()
    const client = track(clientRow, billingClientIds)

    const [recordRow] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'out',
        source: 'generated',
        amount: '100',
        currency: 'RON',
        issuedAt: new Date('2026-08-01T00:00:00Z'),
        billingClientId: client.id,
        paymentStatus: 'unpaid',
      })
      .returning()
    const record = track(recordRow, recordIds)

    await service.updatePayment(record.id, { paymentStatus: 'paid' })

    const [updatedClient] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updatedClient?.billingDueDate).toBe('2026-09-01')
  })

  it('NU rostogolește dacă billingDueDate e deja în viitor față de factura plătită (istoric)', async () => {
    const [clientRow] = await db
      .insert(billingClients)
      .values({
        name: 'Client Test No-Rollover',
        cif: '88888888',
        address: 'Str. Test 2',
        billingCycle: 'monthly',
        billingCycleDay: 1,
        billingDueDate: '2026-09-01',
      })
      .returning()
    const client = track(clientRow, billingClientIds)

    const [recordRow] = await db
      .insert(financialRecords)
      .values({
        type: 'invoice',
        direction: 'out',
        source: 'generated',
        amount: '50',
        currency: 'RON',
        issuedAt: new Date('2026-07-01T00:00:00Z'),
        billingClientId: client.id,
        paymentStatus: 'unpaid',
      })
      .returning()
    const record = track(recordRow, recordIds)

    await service.updatePayment(record.id, { paymentStatus: 'paid' })

    const [updatedClient] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(updatedClient?.billingDueDate).toBe('2026-09-01')
  })
})
