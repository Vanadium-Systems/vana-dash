import { z } from 'zod'

// Nu importăm din modules/metrics/schema.ts (regula #5 — module izolate, no
// cross-imports) — mic duplicat intenționat cu PeriodQuerySchema de acolo.
export const PeriodQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

// Sprint D, Track 2 — istoric curs BNR (pagină Financials nouă). `from`/`to` sunt date
// simple (YYYY-MM-DD, ca exchangeRates.date), nu datetime — spre deosebire de PeriodQuerySchema.
export const ExchangeRateQuerySchema = z.object({
  currency: z.enum(['EUR', 'USD']),
  period: z.enum(['daily', 'monthly', 'yearly']).default('daily'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
