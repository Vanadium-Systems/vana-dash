import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

export const RecordsQuerySchema = z.object({
  direction: z.enum(['in', 'out']).optional(),
  type: z.enum(['invoice', 'expense', 'payment']).optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
  anafStatus: z.enum(['draft', 'pending', 'validated', 'rejected']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export const RecordIdParamsSchema = z.object({ id: z.string().uuid() })

export const ManualRecordCreateSchema = z.object({
  type: z.enum(['invoice', 'expense', 'payment']),
  direction: z.enum(['in', 'out']).default('in'),
  amount: z.number().positive(),
  currency: z.enum(['RON', 'EUR', 'USD']).default('RON'),
  description: z.string().optional(),
  category: z.string().optional(),
  counterpartyName: z.string().optional(),
  counterpartyCif: z.string().optional(),
  issuedAt: z.coerce.date(),
  dueAt: z.coerce.date().optional(),
  // Sprint D, Track A — taxare inversă TVA (achiziții de servicii UE/non-UE, direction='in').
  reverseChargeType: z.enum(['none', 'eu_services', 'non_eu_services']).default('none'),
  counterpartyCountry: z.string().length(2).toUpperCase().optional(),
  // .nonnegative(), NU .positive() (2026-08-01, Stefan) — la achiziții non-UE cota chiară e
  // 0%, o valoare reală și distinctă de "necompletat", nu doar un artefact de prefill uitat.
  reverseChargeVatRate: z.number().nonnegative().optional(),
})

// D301/D390 — lună de raportare (achiziții reverse-charge din perioada respectivă).
export const DeclarationMonthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, lazyTr('errors.accounting.expectedMonthFormat')),
})

export const DeclarationExportQuerySchema = DeclarationMonthQuerySchema.extend({
  format: z.enum(['pdf', 'xml', 'csv']).default('xml'),
})

// Pachet trimestrial (Sprint D, Track B) — 'YYYY-Qn'.
export const QuarterQuerySchema = z.object({
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/, lazyTr('errors.accounting.expectedQuarterFormat')),
})

// Cheltuieli recurente (lunar/anual) — materializate automat în financial_records prin
// jobs/recurring-expenses.ts. Cheltuielile one-time folosesc ManualRecordCreateSchema de mai sus.
const RecurringExpenseBaseSchema = z.object({
  description: z.string().min(1),
  category: z.string().optional(),
  amount: z.number().positive(),
  currency: z.enum(['RON', 'EUR', 'USD']).default('RON'),
  cycle: z.enum(['monthly', 'annual']),
  cycleDay: z.number().int().min(1).max(31),
  cycleMonth: z.number().int().min(1).max(12).optional(),
  // modules/calendar/service.ts citește direct din recurring_expenses (ocurențe virtuale,
  // nemateralizate) — toggle per-cheltuială, implicit true.
  showInCalendar: z.boolean().default(true),
  // Copiate pe fiecare financial_record materializat — mirror ManualRecordCreateSchema mai sus.
  counterpartyName: z.string().optional(),
  counterpartyCif: z.string().optional(),
  reverseChargeType: z.enum(['none', 'eu_services', 'non_eu_services']).default('none'),
  counterpartyCountry: z.string().length(2).toUpperCase().optional(),
  // .nonnegative(), NU .positive() — cota poate fi legitim 0% (achiziții non-UE), vezi
  // ManualRecordCreateSchema mai sus.
  reverseChargeVatRate: z.number().nonnegative().optional(),
  // false = jobul rostogolește nextDueDate dar nu mai materializează în financial_records
  // (rămâne doar reminder de calendar) — evită dubla înregistrare când Stefan introduce
  // manual factura reală primită de la furnizor.
  autoMaterialize: z.boolean().default(true),
})

export const RecurringExpenseCreateSchema = RecurringExpenseBaseSchema.extend({
  // Opțional — dacă lipsește, server-ul calculează primul `nextDueDate` de la azi.
  startDate: z.coerce.date().optional(),
}).refine((v) => v.cycle !== 'annual' || v.cycleMonth !== undefined, {
  message: lazyTr('errors.accounting.cycleMonthRequired'),
  path: ['cycleMonth'],
})

export const RecurringExpenseUpdateSchema = RecurringExpenseBaseSchema.partial()
  .extend({ active: z.boolean().optional() })
  .refine((v) => v.cycle !== 'annual' || v.cycleMonth !== undefined, {
    message: lazyTr('errors.accounting.cycleMonthRequired'),
    path: ['cycleMonth'],
  })

export const RecurringExpenseIdParamsSchema = z.object({ id: z.string().uuid() })

export const PaymentUpdateSchema = z.object({
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
  paidAt: z.coerce.date().optional(),
})

// Codul OAuth primit de la ANAF după consimțirea manuală cu certificatul.
export const AnafExchangeCodeSchema = z.object({
  code: z.string().min(1),
  cif: z.string().min(2).max(13),
})

export const SpvMessagesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
})

// Salvare manuală a unui mesaj SPV (opt-in — vezi spv-messages.ts) — id-ul ANAF vine din URL,
// restul câmpurilor din corpul cererii (frontend le are deja din fetch-ul live, evită un
// round-trip suplimentar la ANAF doar ca să regăsim un mesaj deja afișat).
export const SpvMessageSaveParamsSchema = z.object({ id: z.string().min(1) })
export const SpvMessageSaveBodySchema = z.object({
  type: z.string().min(1),
  detail: z.string(),
  cif: z.string().min(2).max(13),
  createdAt: z.coerce.date(),
})
