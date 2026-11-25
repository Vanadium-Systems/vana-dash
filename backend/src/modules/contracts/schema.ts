import { z } from 'zod'

export const MarkDocumentSignedSchema = z.object({
  isSigned: z.boolean(),
})

export const DocumentIdParamsSchema = z.object({ id: z.string().uuid() })
