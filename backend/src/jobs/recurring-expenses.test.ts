/**
 * jobs/recurring-expenses.ts — materializare zilnică cheltuieli recurente. `modules/accounting/
 * service.js` mockuit la graniță (are propriile teste, service.test.ts) — verificăm doar
 * ORCHESTRAREA: idempotență, rollover, izolarea erorilor per rând (regula #7 CLAUDE.md), la fel
 * ca jobs/vanagreen-billing.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'

const listDueMock = vi.fn()
const hasMaterializedMock = vi.fn()
const materializeMock = vi.fn()
const rollNextDueDateMock = vi.fn()

vi.mock('../modules/accounting/service.js', () => ({
  listDueRecurringExpenses: (...args: unknown[]) => listDueMock(...args),
  hasExpenseMaterializedForDate: (...args: unknown[]) => hasMaterializedMock(...args),
  materializeRecurringExpense: (...args: unknown[]) => materializeMock(...args),
  rollRecurringExpenseNextDueDate: (...args: unknown[]) => rollNextDueDateMock(...args),
}))

const { runRecurringExpensesJob } = await import('./recurring-expenses.js')

function reset() {
  for (const m of [listDueMock, hasMaterializedMock, materializeMock, rollNextDueDateMock]) m.mockReset()
  hasMaterializedMock.mockResolvedValue(false)
  materializeMock.mockResolvedValue({ id: 'record-1' })
  rollNextDueDateMock.mockResolvedValue(undefined)
}

describe('runRecurringExpensesJob', () => {
  it('nu face nimic când nu există cheltuieli scadente', async () => {
    reset()
    listDueMock.mockResolvedValue([])
    await runRecurringExpensesJob()
    expect(materializeMock).not.toHaveBeenCalled()
    expect(rollNextDueDateMock).not.toHaveBeenCalled()
  })

  it('materializează o cheltuială scadentă și rostogolește nextDueDate', async () => {
    reset()
    const expense = { id: 'exp-1', description: 'AWS', nextDueDate: '2026-07-01', autoMaterialize: true }
    listDueMock.mockResolvedValue([expense])

    await runRecurringExpensesJob()

    expect(hasMaterializedMock).toHaveBeenCalledWith('exp-1', '2026-07-01')
    expect(materializeMock).toHaveBeenCalledWith(expense, '2026-07-01')
    expect(rollNextDueDateMock).toHaveBeenCalledWith('exp-1', '2026-07-01')
  })

  it('IDEMPOTENT: dacă scadența a fost deja materializată, sare peste materialize dar tot rostogolește', async () => {
    reset()
    const expense = { id: 'exp-1', description: 'AWS', nextDueDate: '2026-07-01', autoMaterialize: true }
    listDueMock.mockResolvedValue([expense])
    hasMaterializedMock.mockResolvedValue(true)

    await runRecurringExpensesJob()

    expect(materializeMock).not.toHaveBeenCalled()
    expect(rollNextDueDateMock).toHaveBeenCalledWith('exp-1', '2026-07-01')
  })

  it('autoMaterialize=false: nu materializează (furnizorul trimite factură reală), dar tot rostogolește', async () => {
    reset()
    const expense = { id: 'exp-1', description: 'Hetzner', nextDueDate: '2026-07-01', autoMaterialize: false }
    listDueMock.mockResolvedValue([expense])

    await runRecurringExpensesJob()

    expect(hasMaterializedMock).not.toHaveBeenCalled()
    expect(materializeMock).not.toHaveBeenCalled()
    expect(rollNextDueDateMock).toHaveBeenCalledWith('exp-1', '2026-07-01')
  })

  it('CRITICAL — izolare eroare per rând: o cheltuială care aruncă la materialize nu oprește restul lotului', async () => {
    reset()
    const expenseA = { id: 'exp-a', description: 'A', nextDueDate: '2026-07-01', autoMaterialize: true }
    const expenseB = { id: 'exp-b', description: 'B', nextDueDate: '2026-07-01', autoMaterialize: true }
    listDueMock.mockResolvedValue([expenseA, expenseB])
    materializeMock.mockImplementation(async (expense: { id: string }) => {
      if (expense.id === 'exp-a') throw new Error('DB jos')
      return { id: 'record-b' }
    })

    await expect(runRecurringExpensesJob()).resolves.not.toThrow()

    expect(materializeMock).toHaveBeenCalledTimes(2) // ambele au fost încercate
    expect(rollNextDueDateMock).toHaveBeenCalledWith('exp-b', '2026-07-01') // B a mers până la capăt
    expect(rollNextDueDateMock).not.toHaveBeenCalledWith('exp-a', '2026-07-01') // A a picat, nu s-a rostogolit (rămâne scadentă, reîncercată mâine)
  })
})
