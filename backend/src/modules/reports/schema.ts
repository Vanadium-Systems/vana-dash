import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

export const MrrTrendQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})

export const PeriodComparisonQuerySchema = z.object({
  fromA: z.coerce.date(),
  toA: z.coerce.date(),
  fromB: z.coerce.date(),
  toB: z.coerce.date(),
})

export const ExpenseBreakdownTrendQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})

export const MonthlySnapshotQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, lazyTr('errors.accounting.expectedMonthFormat')),
})
