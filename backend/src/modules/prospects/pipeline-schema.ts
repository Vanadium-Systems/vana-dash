import { z } from 'zod'
import { FiltersParamSchema } from './filters.js'

const MAX_RANGE_DAYS = 366

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v))

const checkRange = (v: { from: string; to: string }, ctx: z.RefinementCtx) => {
  const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000
  if (days < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to must not be before from' })
  else if (days > MAX_RANGE_DAYS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `range is at most ${MAX_RANGE_DAYS} days` })
}

const q = z.string().trim().max(200).optional()

export const BoardQuerySchema = z.object({ f: FiltersParamSchema, q })

export const BoardColumnQuerySchema = z.object({
  status: z.string().min(1).max(100),
  f: FiltersParamSchema,
  q,
  page: z.coerce.number().int().min(1).optional(),
})

export const ForecastQuerySchema = z.object({
  f: FiltersParamSchema,
  q,
  months: z.coerce.number().int().min(1).max(12).default(6),
})

export const FunnelQuerySchema = z.object({ from: isoDate, to: isoDate, f: FiltersParamSchema, q }).superRefine(checkRange)

export const ByAgentQuerySchema = z.object({ from: isoDate, to: isoDate }).superRefine(checkRange)
