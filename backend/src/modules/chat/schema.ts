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

// Megolm ciphertext of {v, conversationId, body, attachments}. 64 KB covers a 4000-character
// body in any script plus ten attachments' keys, base64 and Megolm overhead included.
export const EncryptedContentSchema = z.object({
  v: z.literal(1),
  ciphertext: z.string().min(1).max(65_536).regex(/^[A-Za-z0-9+/=]+$/),
  senderDeviceId: z.string().uuid(),
})

export const SendMessageSchema = z.object({
  // Only empty: text travels in `encrypted`. A message with only shared objects has neither.
  body: z.literal('').default(''),
  encrypted: EncryptedContentSchema.optional(),
  // Generat de client (uuid v4) ca mesajul optimist să poată fi dedupe-uit la retrimitere.
  clientId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  replyToId: z.string().uuid().optional(),
  refs: z.array(MessageRefInputSchema).max(5).default([]),
})

export const EditMessageSchema = z.object({ encrypted: EncryptedContentSchema })

/** Re-encrypting an old clear-text message in place (Q-M2). */
export const EncryptLegacySchema = z.object({ encrypted: EncryptedContentSchema })

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

export const MediaQuerySchema = z.object({
  kind: z.enum(['image', 'file']),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
})

export const RecentTargetsQuerySchema = z.object({ q: z.string().trim().max(80).optional() })

export const RefLookupQuerySchema = z.object({ type: z.enum(MESSAGE_REF_TYPES), id: z.string().uuid() })

// ── End-to-end keys (PLAN.md part M) ─────────────────────────────────────────
// vodozemac gives keys and ciphertexts as unpadded base64; the bounds only stop junk.
const B64 = z.string().regex(/^[A-Za-z0-9+/=_-]+$/)
const PublicKey = B64.min(40).max(64)
const OneTimeKey = z.object({ keyId: z.string().min(1).max(64), publicKey: PublicKey })

export const RegisterDeviceSchema = z.object({
  publicIdentityKey: PublicKey,
  signingKey: PublicKey,
  label: z.string().trim().max(120).default(''),
  oneTimeKeys: z.array(OneTimeKey).max(100).default([]),
  fallbackKey: OneTimeKey.optional(),
})

export const UploadKeysSchema = z.object({
  oneTimeKeys: z.array(OneTimeKey).max(100).default([]),
  fallbackKey: OneTimeKey.optional(),
})

export const DeviceParamsSchema = z.object({ deviceId: z.string().uuid() })
export const MyKeysQuerySchema = z.object({ deviceId: z.string().uuid().optional() })

export const IdentitySchema = z.object({
  masterKey: B64.min(40).max(64),
  recoveryCheck: B64.min(20).max(128),
  secretBundle: B64.min(20).max(4096),
  deviceId: z.string().uuid(),
  deviceSignature: B64.min(60).max(128),
  reset: z.boolean().optional(),
})

export const SignDeviceSchema = z.object({ signature: B64.min(60).max(128) })

export const DevicesQuerySchema = z.object({
  userIds: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(50)),
})

export const ClaimKeysSchema = z.object({ deviceIds: z.array(z.string().uuid()).min(1).max(200) })

export const SendToDeviceSchema = z.object({
  senderDeviceId: z.string().uuid(),
  messages: z
    .array(
      z.object({
        deviceId: z.string().uuid(),
        messageType: z.union([z.literal(0), z.literal(1)]),
        ciphertext: B64.min(1).max(16_384),
      }),
    )
    .min(1)
    .max(500),
})

export const PendingToDeviceQuerySchema = z.object({
  deviceId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export const AckToDeviceSchema = z.object({ deviceId: z.string().uuid(), upToId: z.number().int().positive() })

export const PutBackupSchema = z.object({
  sessions: z
    .array(z.object({ sessionId: B64.min(10).max(128), firstIndex: z.number().int().min(0), data: B64.min(1).max(16_384) }))
    .max(200),
})

export const BackupQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(500),
})
