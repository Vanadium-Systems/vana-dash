import { z } from 'zod'

// Contractul C3 (PLAN.md). `body` poate fi gol doar dacă mesajul are atașamente — verificat
// în service, pentru că acolo se știe ce s-a trimis într-adevăr.

export const CreateConversationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dm'), userId: z.string().uuid() }),
  z.object({
    kind: z.literal('group'),
    name: z.string().trim().min(1).max(80),
    memberIds: z.array(z.string().uuid()).max(20).default([]),
  }),
])

export const UpdateConversationSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  addMemberIds: z.array(z.string().uuid()).max(20).optional(),
  removeMemberIds: z.array(z.string().uuid()).max(20).optional(),
  /** „Nu mai notifica" — al omului, deci merge și pe DM. */
  muted: z.boolean().optional(),
})

export const ListMessagesQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const SendMessageSchema = z.object({
  body: z.string().max(4000).default(''),
  // Generat de client (uuid v4) ca mesajul optimist să poată fi dedupe-uit la retrimitere.
  clientId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
})

export const EditMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
})

export const MarkReadSchema = z.object({
  messageId: z.string().uuid(),
})

export const ConversationIdParamsSchema = z.object({ id: z.string().uuid() })
export const MessageIdParamsSchema = z.object({ id: z.string().uuid() })
export const AttachmentIdParamsSchema = z.object({ id: z.string().uuid() })
// `download=1`: fișierul vine prin VPS și la video, ca JS-ul să aibă bytes de salvat (în APK nu
// există download manager, iar R2 nu are CORS pentru fetch).
export const AttachmentQuerySchema = z.object({ download: z.literal('1').optional(), size: z.literal('thumb').optional() })
