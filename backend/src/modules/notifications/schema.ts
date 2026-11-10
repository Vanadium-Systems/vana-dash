import { z } from 'zod'

export const NotificationsQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
})

export const MarkReadSchema = z.union([z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }), z.object({ all: z.literal(true) })])
