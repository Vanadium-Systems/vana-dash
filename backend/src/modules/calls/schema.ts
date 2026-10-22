import { z } from 'zod'

export const ListCallsQuerySchema = z.object({
  status: z.enum(['open', 'ended', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const CreateCallSchema = z.object({
  title: z.string().trim().min(1).max(120),
  expiresInHours: z.number().int().min(1).max(8).default(4),
  prospectId: z.string().uuid().optional(),
  billingClientId: z.string().uuid().optional(),
})

export const UpdateCallSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    prospectId: z.string().uuid().nullable().optional(),
    billingClientId: z.string().uuid().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0)

export const CallIdParamsSchema = z.object({ id: z.string().uuid() })

// 12 random bytes in base64url = 16 characters (shared/lib/call-rooms.ts).
export const PublicCallParamsSchema = z.object({ publicId: z.string().regex(/^[A-Za-z0-9_-]{16}$/) })
