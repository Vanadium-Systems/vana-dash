import { z } from 'zod'

export const ListCallsQuerySchema = z.object({
  status: z.enum(['open', 'ended', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const CreateCallSchema = z.object({
  title: z.string().trim().min(1).max(120),
  expiresInHours: z.number().int().min(1).max(8).default(4),
  kind: z.enum(['audio', 'video']).default('video'),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  prospectId: z.string().uuid().optional(),
  billingClientId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
})

export const UpdateCallSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    prospectId: z.string().uuid().nullable().optional(),
    billingClientId: z.string().uuid().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0)

// Either the whole room, or one person by their LiveKit identity (a user id or "guest:…").
export const ScreenShareBodySchema = z.union([
  z.object({ everyone: z.boolean() }).strict(),
  z.object({ identity: z.string().min(1).max(64), allowed: z.boolean() }).strict(),
])

export const ExtendCallSchema = z.object({ hours: z.number().int().min(1).max(4) }).strict()

export const CallIdParamsSchema = z.object({ id: z.string().uuid() })

// 12 random bytes in base64url = 16 characters (shared/lib/call-rooms.ts).
export const PublicCallParamsSchema = z.object({ publicId: z.string().regex(/^[A-Za-z0-9_-]{16}$/) })

export const PublicCallTokenBodySchema = z.object({
  guestName: z.string().trim().min(1).max(80),
})
