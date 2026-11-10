import { z } from 'zod'
import { ProspectParamsSchema } from './schema.js'

export { ProspectParamsSchema }

export const TransferProspectsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  toUserId: z.string().uuid(),
  note: z.string().trim().min(1).max(2000).optional(),
})

export const CreateTransferRequestSchema = z.object({
  kind: z.enum(['transfer', 'access']),
  note: z.string().trim().min(1).max(2000).optional(),
})

export const TransferRequestParamsSchema = z.object({ rid: z.string().uuid() })

export const DecideTransferRequestSchema = z.object({ action: z.enum(['accept', 'refuse', 'cancel']) })

export const TransferRequestsQuerySchema = z.object({ scope: z.enum(['incoming', 'outgoing']) })

export const CollaboratorParamsSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() })

export const CollaboratorBodySchema = z.object({ level: z.enum(['view', 'edit']) })

export const ReleaseSettingsSchema = z
  .object({
    enabled: z.boolean(),
    idleDays: z.number().int().min(1).max(365),
    warnDays: z.number().int().min(0).max(90),
  })
  .refine((v) => v.warnDays < v.idleDays, { path: ['warnDays'] })
