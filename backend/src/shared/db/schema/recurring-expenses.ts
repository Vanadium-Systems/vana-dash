import { boolean, integer, numeric, pgEnum, pgTable, text, date } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Cadență separată de `billing_client_cycle` (nu reutilizată) — cheltuielile și abonamentele
// clienților sunt domenii diferite, cuplarea lor pe același tip Postgres ar fi o dependență
// artificială (regula #5 CLAUDE.md — module izolate).
export const expenseCycle = pgEnum('expense_cycle', ['monthly', 'annual'])

// Definiția unei cheltuieli recurente (abonamente cloud, chirie, etc.) — materializată automat
// într-un `financial_records` nou de fiecare dată când `nextDueDate` cade scadentă
// (jobs/recurring-expenses.ts), simetric cu billing_clients + jobs/vanagreen-billing.ts pe partea
// de venituri. Cheltuielile one-time NU au rând aici — merg direct în financial_records prin
// POST /api/accounting/records (createManualRecord, deja existent).
export const recurringExpenses = pgTable('recurring_expenses', {
  ...tenantColumns,
  ...standardColumns,
  description: text('description').notNull(),
  category: text('category'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency', { enum: ['RON', 'EUR', 'USD'] }).notNull().default('RON'),
  cycle: expenseCycle('cycle').notNull(),
  cycleDay: integer('cycle_day').notNull(),
  // Obligatoriu doar pt. cycle='annual' (validat Zod la nivel de service, ca la billingClientCycle).
  cycleMonth: integer('cycle_month'),
  nextDueDate: date('next_due_date', { mode: 'string' }).notNull(),
  // Pauză fără ștergere — jobul sare peste rândurile inactive, dar rămân editabile/reactivabile.
  active: boolean('active').notNull().default(true),
  // Toggle per-cheltuială pt. afișare în /calendar (modules/calendar/service.ts citește direct
  // din tabela asta — ocurențe virtuale, nu materializate, la fel ca RRULE). Implicit true — asta
  // e cererea explicită (Stefan vrea să le vadă), poate opri individual pe cele care-l aglomerează.
  showInCalendar: boolean('show_in_calendar').notNull().default(true),
  // Adăugat 2026-08-01 (Stefan — "nu arată furnizoru") — până acum materializeRecurringExpense
  // nu copia NIMIC despre furnizor pe financial_records, deci cheltuiala automată apărea fără
  // contraparte. Mirror exact pe câmpurile de taxare inversă din financial_records/
  // ManualRecordCreateSchema (modules/accounting/schema.ts), ca un abonament recurent (ex.
  // Hetzner, servicii UE) să nu mai aibă nevoie de un al doilea rând fals "TVA INVERS" doar ca
  // să reprezinte cota — se completează o dată aici, se copiază automat la fiecare materializare.
  counterpartyName: text('counterparty_name'),
  counterpartyCif: text('counterparty_cif'),
  counterpartyCountry: text('counterparty_country'),
  reverseChargeType: text('reverse_charge_type', { enum: ['none', 'eu_services', 'non_eu_services'] })
    .notNull()
    .default('none'),
  reverseChargeVatRate: numeric('reverse_charge_vat_rate', { precision: 5, scale: 2 }),
  // Adăugat 2026-08-01 (Stefan — dublare cu factura reală) — dacă furnizorul trimite ulterior o
  // factură reală pentru aceeași perioadă (introdusă manual sau sincronizată), materializarea
  // automată ar produce un al doilea rând pt. aceeași cheltuială. false = jobul tot rostogolește
  // nextDueDate (rămâne reminder în calendar), dar NU mai inserează în financial_records — Stefan
  // introduce cheltuiala reală singur când vine factura.
  autoMaterialize: boolean('auto_materialize').notNull().default(true),
})
