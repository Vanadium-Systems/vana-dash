import { z } from 'zod'

export const CreateTicketSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5000),
  page: z.string().trim().max(200).optional(),
})

export const ReplySchema = z.object({ body: z.string().trim().min(1).max(5000) })

// Autorul poate doar să închidă; redeschiderea se face scriind un răspuns.
export const CloseTicketSchema = z.object({ status: z.literal('inchis') })

export const TicketIdParamsSchema = z.object({ id: z.string().uuid() })

export const PlatformListQuerySchema = z.object({
  status: z.enum(['deschis', 'raspuns', 'inchis']).optional(),
})
