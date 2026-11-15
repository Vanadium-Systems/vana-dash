import { z } from 'zod'

export const CreateApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  features: z
    .array(z.string().min(1).max(80))
    .min(1)
    .refine((keys) => new Set(keys).size === keys.length, 'duplicate features')
    .optional(),
  // Absent = 90 days; an explicit null = never expires.
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).optional(),
})

export const ApiTokenIdParamsSchema = z.object({ id: z.string().uuid() })
