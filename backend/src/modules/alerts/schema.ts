import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

const condition = z.enum(['lt', 'lte', 'gt', 'gte'])
const severity = z.enum(['info', 'warning', 'critical'])

export const CreateAlertRuleSchema = z.object({
  name: z.string().trim().min(1).max(255),
  metricKey: z
    .string()
    .trim()
    .min(1)
    .refine((v) => !v.startsWith('accounting.'), {
      message: lazyTr('errors.alerts.reservedNamespace'),
    }),
  condition,
  threshold: z.number(),
  windowHours: z.number().int().positive().optional(),
  severity: severity.optional(),
  platformId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
})

export const UpdateAlertRuleSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  condition: condition.optional(),
  threshold: z.number().optional(),
  windowHours: z.number().int().positive().optional(),
  severity: severity.optional(),
  platformId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
})

export const ListAlertsQuerySchema = z.object({
  status: z.enum(['active', 'acknowledged', 'all']).optional(),
})

export const SnoozeAlertSchema = z.object({
  days: z.number().int().positive().max(90),
})

// Ack în masă din tab-ul Istoric (PLAN.md Contract F) — fără ruleId = toate alertele active.
export const AckBulkSchema = z.object({
  ruleId: z.string().uuid().optional(),
})
