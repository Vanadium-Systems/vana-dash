import { z } from 'zod'

export const AuditQuerySchema = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
