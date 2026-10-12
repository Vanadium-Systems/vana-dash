import { z } from 'zod'
import { EmailFromSchema } from './schema.js'

export const IdParamsSchema = z.object({ id: z.string().uuid() })

// Atașament de draft — fie nou (content base64, se salvează la write), fie deja salvat dintr-un
// write anterior (storagePath, referit fără re-upload — evită re-salvarea fișierelor neschimbate
// la fiecare autosave).
export const DraftAttachmentSchema = z.union([
  z.object({ filename: z.string().min(1), content: z.string().min(1) }),
  z.object({ filename: z.string().min(1), storagePath: z.string().min(1) }),
])

export const DraftUpsertSchema = z.object({
  // Identitățile sunt dinamice (Setări Email); o listă fixă aici respingea ciornele de pe
  // orice identitate nouă (sales@, 2026-09-28). Validarea cheii se face la trimitere.
  fromKey: EmailFromSchema.default('stefan'),
  to: z.string().default(''),
  subject: z.string().default(''),
  body: z.string().default(''),
  templateId: z.string().uuid().optional(),
  attachments: z.array(DraftAttachmentSchema).max(5).optional(),
})

export const DraftUpdateSchema = DraftUpsertSchema.partial()
