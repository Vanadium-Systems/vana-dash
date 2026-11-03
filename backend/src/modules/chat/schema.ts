import { z } from 'zod'
import { MESSAGE_REF_TYPES } from '../../shared/db/schema/chat.js'

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

// One cursor at most: `before` / `after` page from a message, `around*` opens a window on it.
export const ListMessagesQuerySchema = z
  .object({
    before: z.string().uuid().optional(),
    after: z.string().uuid().optional(),
    around: z.string().uuid().optional(),
    aroundDate: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => [q.before, q.after, q.around, q.aroundDate].filter(Boolean).length <= 1, {
    message: 'before, after, around and aroundDate are exclusive',
  })

export const MessageRefInputSchema = z
  .object({
    type: z.enum(MESSAGE_REF_TYPES),
    id: z.string().uuid(),
    quote: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((ref) => ref.quote === undefined || ref.type === 'email_thread', { message: 'quote is only for email_thread' })

export const SendMessageSchema = z.object({
  body: z.string().max(4000).default(''),
  // Generat de client (uuid v4) ca mesajul optimist să poată fi dedupe-uit la retrimitere.
  clientId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  replyToId: z.string().uuid().optional(),
  refs: z.array(MessageRefInputSchema).max(5).default([]),
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

// One emoji with its variation selector, skin tone or ZWJ sequence. Regional-indicator flags do
// not pass; the quick bar has none.
const EMOJI = /^\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u
export const ReactionParamsSchema = z.object({
  id: z.string().uuid(),
  emoji: z.string().max(16).regex(EMOJI),
})

export const SearchMessagesQuerySchema = z.object({ q: z.string().trim().min(2).max(120) })

export const MediaQuerySchema = z.object({
  kind: z.enum(['image', 'file']),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
})

export const RecentTargetsQuerySchema = z.object({ q: z.string().trim().max(80).optional() })

export const RefLookupQuerySchema = z.object({ type: z.enum(MESSAGE_REF_TYPES), id: z.string().uuid() })
