import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { notifyPush } from '../../shared/lib/push.js'
import { contentDisposition } from '../../shared/lib/text.js'
import { MAX_ATTACHMENT_BYTES, readAttachment, uploadAttachment, uploadEncryptedAttachment } from './attachments.js'
import { hasOpenConnection, markAlive, openConnection, presenceFor, publish, closeConnection } from './presence.js'
import type { ChatEvent } from './presence.js'
import {
  AttachmentIdParamsSchema,
  AttachmentQuerySchema,
  CallActionParamsSchema,
  ConversationIdParamsSchema,
  CreateConversationSchema,
  EditMessageSchema,
  EncryptLegacySchema,
  ListMessagesQuerySchema,
  MarkReadSchema,
  MediaQuerySchema,
  MessageIdParamsSchema,
  ReactionParamsSchema,
  RecentTargetsQuerySchema,
  RefLookupQuerySchema,
  SendMessageSchema,
  StartConversationCallSchema,
  UpdateConversationSchema,
} from './schema.js'
import * as service from './service.js'
import { DeviceNotFoundError, KeysConflictError } from './keys.js'
import { keyRoutes } from './keys-routes.js'
import { ChatCallError, ChatRequestError, ConversationForbiddenError, GroupPermissionError, MessageBodyError } from './service.js'
import { RefFileTooLargeError } from '../../shared/lib/entity-refs.js'
import { fail } from '../../shared/lib/http-error.js'
import { tr, trFor } from '../../shared/lib/i18n.js'

const HEARTBEAT_INTERVAL_MS = 25_000
// "Typing" is published at most this often per person and conversation.
const TYPING_THROTTLE_MS = 3_000
const lastTyping = new Map<string, number>()

function writeEvent(res: ServerResponse, event: ChatEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

export async function chatRoutes(app: FastifyInstance) {
  // Two files at most: an encrypted attachment comes with its encrypted thumbnail.
  await app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 2, fields: 4 } })

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof ConversationForbiddenError) {
      return fail(reply, 404, 'CONVERSATION_NOT_FOUND', { message: error.message })
    }
    if (error instanceof ChatRequestError) return fail(reply, 400, error.code)
    if (error instanceof RefFileTooLargeError) {
      return fail(reply, 413, 'REF_FILE_TOO_LARGE', { message: tr('errors.chat.refFileTooLarge') })
    }
    if (error instanceof MessageBodyError) return fail(reply, 400, 'CHAT_MESSAGE_INVALID', { message: error.message })
    if (error instanceof GroupPermissionError) return fail(reply, 403, 'CHAT_GROUP_FORBIDDEN', { message: error.message })
    if (error instanceof DeviceNotFoundError) {
      return fail(reply, 404, 'CHAT_DEVICE_NOT_FOUND', { message: tr('errors.chat.deviceNotFound') })
    }
    if (error instanceof KeysConflictError) return fail(reply, 409, error.code)
    if (error instanceof ChatCallError) {
      const key =
        error.code === 'not_configured'
          ? 'errors.calls.notConfigured'
          : error.code === 'provider'
            ? 'errors.calls.providerError'
            : 'errors.calls.notFound'
      const code = error.code === 'not_configured' ? 'CALLS_NOT_CONFIGURED' : error.code === 'provider' ? 'CALLS_PROVIDER_FAILED' : 'CALL_NOT_FOUND'
      return fail(reply, error.status, code, { message: tr(key) })
    }
    throw error
  })

  keyRoutes(app)

  // ── Stream (SSE) ───────────────────────────────────────────────────────────
  // O singură conexiune per om deschisă (FE-ul o ține pe toată sesiunea, pentru toate
  // conversațiile), nu una per conversație. `EventSource` nu poate trimite headere, deci
  // autentificarea merge pe cookie — și e same-origin, deci ajunge fără `withCredentials`.
  server.get('/api/chat/stream', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id: userId } = req.me
    const connectionId = randomUUID()
    const stream = reply.raw
    // Răspunsul e scris direct pe socket, deci Fastify nu mai are ce trimite la întoarcerea
    // din handler (patternul din modules/assistant/routes.ts) — și timeout-urile lui nu se aplică.
    reply.hijack()

    stream.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // `no-transform`: Caddy nu mai gzip-uiește fluxul (RFC 9110 §8.8.3) — niciun compresor
      // în plus ținut în memorie per conexiune pe un VPS de 1.9 GB.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    // Browserul reconectează singur după 5s, nu după ~3s implicit: la deploy sau la
    // schimbarea rețelei Wi-Fi → mobil nu vrem o grindă de reconectări.
    stream.write('retry: 5000\n: conectat\n\n')

    openConnection(userId, { id: connectionId, write: (event) => writeEvent(stream, event) })

    const heartbeat = setInterval(() => {
      stream.write(': ping\n\n')
    }, HEARTBEAT_INTERVAL_MS)

    // Handlerul rămâne deschis cât timp socketul e viu; la deconectare rezervăm și redecizia
    // „away" cu întârzierea din presence.ts.
    await new Promise<void>((resolve) => {
      const close = () => {
        clearInterval(heartbeat)
        closeConnection(userId, connectionId)
        resolve()
      }
      req.raw.on('close', close)
      req.raw.on('error', close)
    })
  })

  // Semn de viață al clientului: singurul semn pe care serverul îl poate baza când un device
  // adormit cu socketul „deschis". Rulează doar cât timp pagina e vizibilă (FE-ul).
  server.post('/api/chat/heartbeat', { preHandler: [app.authenticate] }, async (req) => {
    markAlive(req.me.id)
    return { success: true }
  })

  // ── Conversații ────────────────────────────────────────────────────────────

  // Registered before `/conversations/:id` so the static segment wins.
  server.get(
    '/api/chat/conversations/recent-targets',
    { preHandler: [app.authenticate], schema: { querystring: RecentTargetsQuerySchema } },
    async (req) => ({ success: true, data: await service.recentTargets(req.me, req.query.q) }),
  )

  server.get('/api/chat/refs', { preHandler: [app.authenticate], schema: { querystring: RefLookupQuerySchema } }, async (req) => ({
    success: true,
    data: await service.conversationsWithRef(req.me, req.query.type, req.query.id),
  }))

  server.get('/api/chat/refs/preview', { preHandler: [app.authenticate], schema: { querystring: RefLookupQuerySchema } }, async (req) => ({
    success: true,
    data: await service.previewRef(req.me, req.query.type, req.query.id),
  }))

  server.get('/api/chat/conversations', { preHandler: [app.authenticate] }, async (req) => {
    const list = await service.listConversations(req.me)
    const now = new Date()
    await publishDelivered(req.me.id, now, await service.markDelivered(req.me.id, now))
    return {
      success: true,
      data: list.map((conversation) => ({
        ...conversation,
        members: conversation.members.map((member) => ({ ...member, presence: presenceFor(member.id) })),
      })),
    }
  })

  server.post(
    '/api/chat/conversations',
    { preHandler: [app.authenticate], schema: { body: CreateConversationSchema } },
    async (req, reply) => {
      const body = req.body
      const id =
        body.kind === 'dm'
          ? await service.openDm(req.me, body.userId)
          : await service.createGroup(req.me, { name: body.name, memberIds: body.memberIds })
      publish({ type: 'conversation.updated', conversationId: id }, await service.memberIds(id))
      return reply.code(201).send({ success: true, data: { id } })
    },
  )

  server.patch(
    '/api/chat/conversations/:id',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: UpdateConversationSchema } },
    async (req) => {
      const { id } = req.params
      // Read before the change: someone just removed still has the group in the list.
      const before = await service.memberIds(id)
      await service.updateConversation(req.me, id, req.body)
      const after = await service.memberIds(id)
      publish({ type: 'conversation.updated', conversationId: id }, [...new Set([...before, ...after])])
      return { success: true }
    },
  )

  server.get(
    '/api/chat/conversations/:id/messages',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, querystring: ListMessagesQuerySchema } },
    async (req) => {
      const data = await service.listMessages(req.me, req.params.id, req.query)
      const now = new Date()
      await publishDelivered(req.me.id, now, await service.markDelivered(req.me.id, now, req.params.id))
      return { success: true, data }
    },
  )

  server.post(
    '/api/chat/conversations/:id/messages',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: SendMessageSchema } },
    async (req) => {
      const { id: conversationId } = req.params
      await service.assertMember(conversationId, req.me.id)
      const prepared = await service.prepareRefs(req.me, req.body.refs)
      // Archive files travel as chat attachments: uploaded unattached, linked by sendMessage.
      const copied: (string | undefined)[] = []
      for (const ref of prepared.rows) {
        copied.push(ref.file ? (await uploadAttachment(req.me, ref.file)).id : undefined)
      }
      const message = await service.sendMessage(req.me, conversationId, req.body, prepared, copied)
      publish({ type: 'message.created', conversationId, message }, await service.memberIds(conversationId))
      void notifyMembers(conversationId, message)
      return { success: true, data: message }
    },
  )

  server.post(
    '/api/chat/conversations/:id/calls',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: StartConversationCallSchema } },
    async (req, reply) => {
      const { id: conversationId } = req.params
      const result = await service.startConversationCall(req.me, conversationId, req.body)
      const allMembers = await service.memberIds(conversationId)
      const others = allMembers.filter((userId) => userId !== req.me.id)
      publish({ type: 'message.created', conversationId, message: result.message }, allMembers)
      if (others.length > 0) {
        publish(
          {
            type: 'call.incoming',
            conversationId,
            callId: result.call.id,
            messageId: result.message.id,
            kind: result.call.kind,
            callerUserId: req.me.id,
            callerName: result.callerName,
            title: result.call.title,
            encrypted: result.message.encrypted,
          },
          others,
        )
        void notifyIncomingCall(conversationId, req.me.id, result.call.id, result.call.kind)
      }
      return reply.code(201).send({ success: true, data: result })
    },
  )

  server.post(
    '/api/chat/calls/:id/decline',
    { preHandler: [app.authenticate], schema: { params: CallActionParamsSchema } },
    async (req) => {
      const { conversationId, callId, userName } = await service.declineConversationCall(req.me, req.params.id)
      const others = await service.memberIds(conversationId, req.me.id)
      if (others.length > 0) {
        publish({ type: 'call.declined', conversationId, callId, userId: req.me.id, userName }, others)
      }
      return { success: true }
    },
  )

  server.post(
    '/api/chat/calls/:id/end',
    { preHandler: [app.authenticate], schema: { params: CallActionParamsSchema } },
    async (req) => {
      const { conversationId, callId } = await service.endConversationCall(req.me, req.params.id)
      const members = await service.memberIds(conversationId)
      publish({ type: 'call.ended', conversationId, callId }, members)
      publish({ type: 'conversation.updated', conversationId }, members)
      return { success: true }
    },
  )

  server.post(
    '/api/chat/conversations/:id/read',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: MarkReadSchema } },
    async (req) => {
      const { id: conversationId } = req.params
      const { messageId } = req.body
      await service.markRead(req.me, conversationId, messageId)
      publish({ type: 'read', conversationId, userId: req.me.id, messageId, at: new Date().toISOString() }, await service.memberIds(conversationId))
      return { success: true }
    },
  )

  server.post(
    '/api/chat/conversations/:id/typing',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema } },
    async (req) => {
      const { id: conversationId } = req.params
      await service.assertMember(conversationId, req.me.id)
      const key = `${req.me.id}:${conversationId}`
      const now = Date.now()
      if (now - (lastTyping.get(key) ?? 0) >= TYPING_THROTTLE_MS) {
        lastTyping.set(key, now)
        publish({ type: 'typing', conversationId, userId: req.me.id }, await service.memberIds(conversationId, req.me.id))
      }
      return { success: true }
    },
  )

  server.get(
    '/api/chat/conversations/:id/media',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, querystring: MediaQuerySchema } },
    async (req) => ({ success: true, data: await service.listMedia(req.me, req.params.id, req.query) }),
  )

  // ── Mesaje ─────────────────────────────────────────────────────────────────

  server.put(
    '/api/chat/messages/:id/reactions/:emoji',
    { preHandler: [app.authenticate], schema: { params: ReactionParamsSchema } },
    async (req) => {
      const { conversationId, reactions } = await service.addReaction(req.me, req.params.id, req.params.emoji)
      publish(
        { type: 'reaction.updated', conversationId, messageId: req.params.id, reactions },
        await service.memberIds(conversationId),
      )
      return { success: true, data: { reactions } }
    },
  )

  server.delete(
    '/api/chat/messages/:id/reactions/:emoji',
    { preHandler: [app.authenticate], schema: { params: ReactionParamsSchema } },
    async (req) => {
      const { conversationId, reactions } = await service.removeReaction(req.me, req.params.id, req.params.emoji)
      publish(
        { type: 'reaction.updated', conversationId, messageId: req.params.id, reactions },
        await service.memberIds(conversationId),
      )
      return { success: true, data: { reactions } }
    },
  )

  server.patch(
    '/api/chat/messages/:id',
    { preHandler: [app.authenticate], schema: { params: MessageIdParamsSchema, body: EditMessageSchema } },
    async (req) => {
      const message = await service.editMessage(req.me, req.params.id, req.body.encrypted)
      publish(
        { type: 'message.updated', conversationId: message.conversationId, message },
        await service.memberIds(message.conversationId),
      )
      return { success: true, data: message }
    },
  )

  server.post(
    '/api/chat/messages/:id/encrypt',
    { preHandler: [app.authenticate], schema: { params: MessageIdParamsSchema, body: EncryptLegacySchema } },
    async (req) => {
      const conversationId = await service.encryptLegacyMessage(req.me, req.params.id, req.body.encrypted)
      // Members' apps swap the clear text for the encrypted copy; nothing changes on screen.
      const [message] = await service.messagesById(req.me, [req.params.id])
      if (message) publish({ type: 'message.updated', conversationId, message }, await service.memberIds(conversationId))
      return { success: true }
    },
  )

  server.delete(
    '/api/chat/messages/:id',
    { preHandler: [app.authenticate], schema: { params: MessageIdParamsSchema } },
    async (req) => {
      const { id, conversationId } = await service.deleteMessage(req.me, req.params.id)
      // Evenimentul poartă doar id-ul: clientul îl șterge din listă (mesajul șters n-are
      // conținut de trimis, și asta nu se poate șterge — vezi DeletedMessage).
      publish({ type: 'message.updated', conversationId, message: { id } }, await service.memberIds(conversationId))
      return { success: true }
    },
  )

  // ── Atașamente ─────────────────────────────────────────────────────────────

  server.post('/api/chat/attachments', { preHandler: [app.authenticate] }, async (req, reply) => {
    // Fields first, then `file` and, for an encrypted image, `thumbnail` (the client sends them
    // in this order). Buffered, not streamed to R2, so the size limit applies before anything
    // reaches the bucket: a 2 GB file would otherwise fill the VPS with buffer before the refusal.
    const fields: Record<string, string> = {}
    const files: Record<string, { buffer: Buffer; filename: string; mimetype: string }> = {}
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') fields[part.fieldname] = String(part.value)
        else files[part.fieldname] = { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype }
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return fail(reply, 413, 'PAYLOAD_TOO_LARGE', { message: tr('errors.chat.fileTooLarge') })
      }
      throw err
    }
    const data = files.file
    if (!data) return fail(reply, 400, 'FILE_MISSING', { message: tr('errors.files.missing') })
    // Clear files are refused like clear text: only Archive copies (made by the server, from a
    // module that is not end-to-end) are stored unencrypted.
    if (fields.encrypted !== '1') return fail(reply, 400, 'NOT_ENCRYPTED')
    try {
      const stored = await uploadEncryptedAttachment(req.me, {
        buffer: data.buffer,
        thumbnail: files.thumbnail?.buffer ?? null,
        mediaKind: fields.kind === 'image' ? 'image' : 'file',
      })
      return { success: true, data: stored }
    } catch (err) {
      req.log.warn({ err }, 'chat attachment upload failed')
      return fail(reply, 502, 'STORAGE_UNAVAILABLE')
    }
  })

  server.get(
    '/api/chat/attachments/:id',
    { preHandler: [app.authenticate], schema: { params: AttachmentIdParamsSchema, querystring: AttachmentQuerySchema } },
    async (req, reply) => {
      const file = await readAttachment(req.me.id, req.params.id, req.query.download === '1', req.query.size === 'thumb')
      if (!file) return fail(reply, 404, 'ATTACHMENT_NOT_FOUND', { message: tr('errors.chat.attachmentNotFound') })
      if (file.kind === 'redirect') return reply.redirect(file.url, 302)
      reply.header('X-Content-Type-Options', 'nosniff')
      // An attachment never changes after upload, so the phone keeps it for good instead of
      // pulling every photo from R2 through the VPS again each day.
      reply.header('Cache-Control', 'private, max-age=31536000, immutable')
      reply.header('Content-Disposition', contentDisposition(file.inline && req.query.download !== '1' ? 'inline' : 'attachment', file.filename))
      return reply.type(file.contentType).send(file.buffer)
    },
  )
}

// The authors' second tick. Sent to every member, the reader included: their other tabs and
// devices show the same ticks.
async function publishDelivered(userId: string, upTo: Date, conversationIds: string[]): Promise<void> {
  const at = upTo.toISOString()
  for (const conversationId of conversationIds) {
    publish({ type: 'delivered', conversationId, userId, at }, await service.memberIds(conversationId))
  }
}

/**
 * Push doar către oamenii fără conexiune SSE deschisă: cine are fluxul deschis primește
 * mesajul prin el în aceeași secundă, iar o notificare pe telefon ar fi doar duplicat.
 *
 * End-to-end (part M): the notification carries who wrote, never what. The text is encrypted,
 * and a push goes through Google (FCM) or the browser vendor's push service. Shared objects'
 * titles stay out too, for the same reason.
 */
const MAX_PUSH_CIPHERTEXT_CHARS = 2400

async function notifyMembers(
  conversationId: string,
  message: { authorUserId: string; encrypted?: { ciphertext: string } | null },
): Promise<void> {
  try {
    const target = await service.pushTarget(conversationId, message.authorUserId)
    if (!target) return
    const offline = target.recipients.filter((userId) => !hasOpenConnection(userId))
    if (offline.length === 0) return

    const ciphertext = message.encrypted?.ciphertext
    const e2e =
      ciphertext && ciphertext.length <= MAX_PUSH_CIPHERTEXT_CHARS
        ? { conversationId, ciphertext, kind: target.kind, byline: target.byline }
        : undefined

    await notifyPush(
      'mesaje',
      (locale) => ({
        title: target.title,
        body:
          target.kind === 'group'
            ? `${target.byline}: ${trFor(locale, 'push.chat.newMessage')}`
            : trFor(locale, 'push.chat.newMessage'),
        url: `/messages/${conversationId}`,
        // One notification per conversation, which the app clears once it is read anywhere.
        tag: `chat-${conversationId}`,
        e2e,
      }),
      offline,
    )
  } catch (err) {
    // Pushul e canal suplimentar, nu condiție pentru trimiterea mesajului (regula #7).
    console.error(`[chat] push pentru ${conversationId} eșuat: ${String(err)}`)
  }
}

async function notifyIncomingCall(
  conversationId: string,
  callerUserId: string,
  callId: string,
  kind: 'audio' | 'video',
): Promise<void> {
  try {
    const target = await service.pushTarget(conversationId, callerUserId)
    if (!target) return
    const offline = target.recipients.filter((userId) => !hasOpenConnection(userId))
    if (offline.length === 0) return

    const key = kind === 'audio' ? 'push.chat.incomingCallAudio' : 'push.chat.incomingCallVideo'
    await notifyPush(
      'mesaje',
      (locale) => ({
        title: target.title,
        body:
          target.kind === 'group'
            ? `${target.byline}: ${trFor(locale, key)}`
            : trFor(locale, key),
        url: `/calls/${callId}`,
        tag: `call-${callId}`,
      }),
      offline,
    )
  } catch (err) {
    console.error(`[chat] push apel pentru ${conversationId} eșuat: ${String(err)}`)
  }
}
