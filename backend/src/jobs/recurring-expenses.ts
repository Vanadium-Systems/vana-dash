import cron from 'node-cron'
import * as accountingService from '../modules/accounting/service.js'

// Zilnic: materializează fiecare recurring_expense activă și scadentă (nextDueDate <= azi) într-un
// financial_record nou (direction='in', type='expense'), apoi rostogolește nextDueDate — simetric
// cu jobs/vanagreen-billing.ts (partea de venituri). Idempotent: verifică înainte dacă scadența
// respectivă a fost deja materializată, ca rulările repetate să nu dubleze cheltuiala.
//
// '30 7 * * *' — între bnr-daily-fetch.ts (vechi 06:00) și billing-cycle-rollover.ts (08:00),
// fără suprapunere. jobs/vanagreen-billing.ts s-a mutat la 11:30 UTC 2026-08-01 (așteaptă cursul
// BNR al zilei) — independent de cheltuielile recurente, ora asta rămâne neschimbată.
const CRON_EXPR = '30 7 * * *'

export function startRecurringExpensesJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runRecurringExpensesJob()
  })
  console.log(`[recurring-expenses] Scheduled (${CRON_EXPR})`)
}

export async function runRecurringExpensesJob(): Promise<void> {
  const todayIso = new Date().toISOString().slice(0, 10)
  const due = await accountingService.listDueRecurringExpenses(todayIso)
  if (due.length === 0) return

  for (const expense of due) {
    try {
      const dueDateIso = expense.nextDueDate
      // autoMaterialize=false — furnizorul trimite factură reală pe care Stefan o introduce
      // manual (evită dubla înregistrare, vezi schema/recurring-expenses.ts) — jobul tot
      // rostogolește nextDueDate mai jos, rămâne doar reminder de calendar.
      const already = expense.autoMaterialize && (await accountingService.hasExpenseMaterializedForDate(expense.id, dueDateIso))
      if (expense.autoMaterialize && !already) {
        await accountingService.materializeRecurringExpense(expense, dueDateIso)
        console.log(`[recurring-expenses] materializat "${expense.description}" (${expense.id}) pt. ${dueDateIso}`)
      }
      await accountingService.rollRecurringExpenseNextDueDate(expense.id, dueDateIso)
    } catch (err) {
      console.error(`[recurring-expenses] eroare la cheltuiala ${expense.id}:`, err)
    }
  }
}
