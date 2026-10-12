import { z } from 'zod'

export const PeriodQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  platformId: z.string().uuid().optional(),
})

export const SeriesQuerySchema = PeriodQuerySchema.extend({
  metricKey: z.string().min(1),
})

// Wave 0/1, sprint de-hardcodare (2026-08-20) — înlocuiește KPI_CARDS hardcodat din
// OverviewPage.tsx. Listă de metric key-uri (standard din platform_metrics SAU built-in-uri
// speciale ca `mrr`, care nu vin din platform_metrics — vezi METRIC_KEYS.md) — ordinea din
// array e ordinea de afișare a cardurilor.
export const OverviewConfigUpdateSchema = z.object({
  visibleKpis: z.array(z.string().min(1)).max(20),
})
