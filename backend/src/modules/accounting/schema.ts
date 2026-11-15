import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'
import { updateSchema } from '../../shared/lib/update-schema.js'

export const RECORD_TABS = ['all', 'draft', 'open', 'overdue', 'paid', 'rejected'] as const
export type RecordTab = (typeof RECORD_TABS)[number]

export const RecordsQuerySchema = z
  .object({
    direction: z.enum(['in', 'out']).optional(),
    type: z.enum(['invoice', 'expense', 'payment']).optional(),
    paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
    anafStatus: z.enum(['draft', 'pending', 'validated', 'rejected']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
    tab: z.enum(RECORD_TABS).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { path: ['to'], message: lazyTr('errors.accounting.periodReversed') })

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

export const DeclarationFilingBodySchema = DeclarationMonthQuerySchema.extend({
  anafIndex: z.string().trim().min(1).max(30),
  filedAt: z.coerce.date().optional(),
})

export const DeclarationLineParamsSchema = z.object({ id: z.string().uuid() })

export const DeclarationLineUpdateSchema = z.object({
  documentNumber: z.string().max(50).optional(),
  issuedAt: z.coerce.date().optional(),
  amount: z.number().positive().optional(),
  reverseChargeType: z.enum(['none', 'eu_services', 'non_eu_services']).optional(),
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

export const RecurringExpenseUpdateSchema = updateSchema(RecurringExpenseBaseSchema)
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

// ── Supplier email rules & email invoice ingestion ───────────────────────────

const SENDER_PATTERN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SENDER_PATTERN_DOMAIN_RE = /^@[a-z0-9.-]+\.[a-z]{2,}$/

export function isValidSenderPattern(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return SENDER_PATTERN_EMAIL_RE.test(normalized) || SENDER_PATTERN_DOMAIN_RE.test(normalized)
}

export const SupplierRuleCreateSchema = z.object({
  senderPattern: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(200)
    .refine(isValidSenderPattern, {
      message: 'Expected a valid email address or @domain.tld',
    }),
  subjectContains: z.string().trim().max(200).nullish(),
  attachmentNamePattern: z.string().trim().max(200).nullish(),
  counterpartyName: z.string().trim().min(1).max(200),
  counterpartyCif: z.string().trim().max(50).nullish(),
  counterpartyCountry: z.string().trim().length(2).toUpperCase().nullish(),
  currency: z.enum(['RON', 'EUR', 'USD']).default('EUR'),
  category: z.string().trim().max(100).nullish(),
  reverseChargeType: z.enum(['none', 'eu_services', 'non_eu_services']).default('none'),
  reverseChargeVatRate: z.number().nonnegative().max(100).nullish(),
  recurringExpenseId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
})

export const SupplierRuleUpdateSchema = updateSchema(SupplierRuleCreateSchema)

export const SupplierRuleIdParamsSchema = z.object({ id: z.string().uuid() })

export const SupplierRuleBackfillSchema = z.object({
  months: z.number().int().min(1).max(12).default(3),
  ruleId: z.string().uuid().optional(),
})

export const PrefillFromEmailQuerySchema = z.object({
  messageId: z.string().uuid(),
  attachmentId: z.string().uuid(),
})

export const ImportFromEmailBodySchema = z.object({
  messageId: z.string().uuid(),
  attachmentId: z.string().uuid(),
  counterpartyName: z.string().trim().min(1).max(200),
  counterpartyCif: z.string().trim().max(50).nullish(),
  counterpartyCountry: z.string().trim().length(2).toUpperCase().nullish(),
  documentNumber: z.string().trim().max(50).nullish(),
  issuedAt: z.coerce.date(),
  amount: z.number().nonnegative(),
  currency: z.enum(['RON', 'EUR', 'USD']).default('EUR'),
  category: z.string().trim().max(100).nullish(),
  reverseChargeType: z.enum(['none', 'eu_services', 'non_eu_services']).default('none'),
  reverseChargeVatRate: z.number().nonnegative().max(100).nullish(),
  createRule: z.boolean().default(false),
  senderPattern: z.string().trim().toLowerCase().nullish(),
  attachmentNamePattern: z.string().trim().max(200).nullish(),
})

// ── Record review confirmation & manual PDF upload ───────────────────────────

export const ConfirmRecordReviewSchema = z.object({
  documentNumber: z.string().trim().max(50).nullish(),
  issuedAt: z.coerce.date().optional(),
  amount: z.number().nonnegative().optional(),
  currency: z.enum(['RON', 'EUR', 'USD']).optional(),
  counterpartyName: z.string().trim().min(1).max(200).optional(),
  counterpartyCif: z.string().trim().max(50).nullish(),
  counterpartyCountry: z.string().trim().length(2).toUpperCase().nullish(),
  reverseChargeType: z.enum(['none', 'eu_services', 'non_eu_services']).optional(),
  reverseChargeVatRate: z.number().nonnegative().max(100).nullish(),
})

export const UploadRecordPdfSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1),
})

// ── Monthly close checklist (Facturi -> Luna) ────────────────────────────────

export const MonthCloseQuerySchema = DeclarationMonthQuerySchema

export const MonthCloseArchiveMissingBodySchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/, lazyTr('errors.accounting.expectedMonthFormat')).optional(),
  })
  .optional()

export const MonthCloseArchiveMissingQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, lazyTr('errors.accounting.expectedMonthFormat')).optional(),
})

export const FulfillExpectedBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, lazyTr('errors.accounting.expectedMonthFormat')),
  recurringExpenseId: z.string().uuid().nullish(),
  supplierRuleId: z.string().uuid().nullish(),
  counterpartyName: z.string().trim().min(1).max(200).nullish(),
  counterpartyCif: z.string().trim().max(50).nullish(),
  counterpartyCountry: z.string().trim().length(2).toUpperCase().nullish(),
  reverseChargeType: z.enum(['none', 'eu_services', 'non_eu_services']).optional(),
  reverseChargeVatRate: z.number().nonnegative().max(100).nullish(),
  documentNumber: z.string().trim().max(50).nullish(),
  issuedAt: z.coerce.date(),
  amount: z.number().nonnegative(),
  currency: z.enum(['RON', 'EUR', 'USD']).default('EUR'),
  category: z.string().trim().max(100).nullish(),
  filename: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1),
})

export const MonthCloseStatusBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, lazyTr('errors.accounting.expectedMonthFormat')),
  closed: z.boolean(),
  note: z.string().trim().max(500).nullish(),
})
