import { z } from 'zod'

export const MetaRoutesQuerySchema = z.object({ filter: z.string().max(100).optional() })
