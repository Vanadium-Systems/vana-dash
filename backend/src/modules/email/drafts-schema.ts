import { z } from 'zod'
import { EmailFromSchema } from './schema.js'
import { updateSchema } from '../../shared/lib/update-schema.js'

export const IdParamsSchema = z.object({ id: z.string().uuid() })

// Atașament de draft — fie nou (content base64, se salvează la write), fie deja salvat dintr-un
// write anterior (storagePath, referit fără re-upload — evită re-salvarea fișierelor neschimbate
// la fiecare autosave).
export const DraftAttachmentSchema = z.union([
  z.object({ filename: z.string().min(1), content: z.string().min(1) }),
  z.object({ filename: z.string().min(1), storagePath: z.string().min(1) }),
])

const DraftBaseSchema = z.object({
  // Identitățile sunt dinamice (Setări Email); o listă fixă aici respingea ciornele de pe
  // orice identitate nouă (sales@, 2026-09-28). Validarea cheii se face la trimitere.
  fromKey: EmailFromSchema.default('stefan'),
  to: z.string().default(''),
  subject: z.string().default(''),
  body: z.string().default(''),
  templateId: z.string().uuid().optional(),
  attachments: z.array(DraftAttachmentSchema).max(5).optional(),
  mode: z.enum(['new', 'reply', 'reply_all', 'forward']).default('new'),
  threadId: z.string().uuid().nullish(),
  sourceMessageId: z.string().uuid().nullish(),
  cc: z.string().default(''),
})

export const DraftUpsertSchema = DraftBaseSchema.superRefine((draft, ctx) => {
  if ((draft.mode === 'reply' || draft.mode === 'reply_all') && !draft.threadId) {
    ctx.addIssue({ code: 'custom', path: ['threadId'], message: 'threadId is required for replies' })
  }
  if (draft.mode === 'forward' && !draft.sourceMessageId) {
    ctx.addIssue({ code: 'custom', path: ['sourceMessageId'], message: 'sourceMessageId is required for forwards' })
  }
})

// Refinements stay off the PATCH body: a partial update has no mode to check against.
export const DraftUpdateSchema = updateSchema(DraftBaseSchema).extend({
  expectedUpdatedAt: z.string().datetime().optional(),
})

export const DraftsQuerySchema = z.object({ threadId: z.string().uuid().optional() })

// The last message the person saw on the thread: a reply sent meanwhile answers 409. Parsed in
// the handler, not as the route's body schema: Fastify would then require a body, and a plain
// "send this draft" call has none.
export const DraftSendSchema = z.object({ lastSeenMessageId: z.string().uuid().nullish() })
