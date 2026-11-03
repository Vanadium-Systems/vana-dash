import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { notifyPush } from '../../shared/lib/push.js'
import { MAX_ATTACHMENT_BYTES, readAttachment, uploadAttachment } from './attachments.js'
import { hasOpenConnection, markAlive, openConnection, presenceFor, publish, closeConnection } from './presence.js'
import type { ChatEvent } from './presence.js'
import {
  AttachmentIdParamsSchema,
  AttachmentQuerySchema,
  ConversationIdParamsSchema,
  CreateConversationSchema,
  EditMessageSchema,
  ListMessagesQuerySchema,
  MarkReadSchema,
  MediaQuerySchema,
  MessageIdParamsSchema,
  ReactionParamsSchema,
  RecentTargetsQuerySchema,
  RefLookupQuerySchema,
  SearchMessagesQuerySchema,
  SendMessageSchema,
  UpdateConversationSchema,
} from './schema.js'
import * as service from './service.js'
import { ChatRequestError, ConversationForbiddenError, GroupPermissionError, MessageBodyError } from './service.js'
import { RefFileTooLargeError } from '../../shared/lib/entity-refs.js'
import { tr, trFor } from '../../shared/lib/i18n.js'

const HEARTBEAT_INTERVAL_MS = 25_000
// Mesajul apare și în notificarea push; trunchiem ca unul lung să nu umple bara de
// notificări a telefonului.
const PUSH_BODY_MAX = 140
// "Typing" is published at most this often per person and conversation.
const TYPING_THROTTLE_MS = 3_000
const lastTyping = new Map<string, number>()

function writeEvent(res: ServerResponse, event: ChatEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

export async function chatRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof ConversationForbiddenError) {
      return reply.code(404).send({ success: false, error: error.message })
    }
    if (error instanceof ChatRequestError) {
      return reply.code(400).send({ success: false, error: { code: error.code } })
    }
    if (error instanceof RefFileTooLargeError) {
      return reply.code(413).send({ success: false, error: { code: 'REF_FILE_TOO_LARGE', message: tr('errors.chat.refFileTooLarge') } })
    }
    if (error instanceof MessageBodyError) {
      return reply.code(400).send({ success: false, error: error.message })
    }
    if (error instanceof GroupPermissionError) {
      return reply.code(403).send({ success: false, error: error.message })
    }
    throw error
  })

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
      await service.updateConversation(req.me, id, req.body)
      publish({ type: 'conversation.updated', conversationId: id }, await service.memberIds(id))
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
    '/api/chat/conversations/:id/read',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: MarkReadSchema } },
    async (req) => {
      const { id: conversationId } = req.params
      const { messageId } = req.body
      await service.markRead(req.me, conversationId, messageId)
      publish({ type: 'read', conversationId, userId: req.me.id, messageId }, await service.memberIds(conversationId))
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
    '/api/chat/conversations/:id/search',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, querystring: SearchMessagesQuerySchema } },
    async (req) => ({ success: true, data: await service.searchMessages(req.me, req.params.id, req.query.q) }),
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
      const message = await service.editMessage(req.me, req.params.id, req.body.body)
      publish(
        { type: 'message.updated', conversationId: message.conversationId, message },
        await service.memberIds(message.conversationId),
      )
      return { success: true, data: message }
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
    const data = await req.file()
    if (!data) return reply.code(400).send({ success: false, error: tr('errors.files.missing') })
    // Bufferizat (nu streamed în R2) ca limita pe dimensiune să fie impusă înainte de a scrie
    // ceva în bucket — altfel un fișier de 2 GB ar umple VPS-ul cu buffer înainte de refuz.
    let buffer: Buffer
    try {
      buffer = await data.toBuffer()
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ success: false, error: tr('errors.chat.fileTooLarge') })
      }
      throw err
    }
    try {
      const stored = await uploadAttachment(req.me, { filename: data.filename, contentType: data.mimetype, buffer })
      return { success: true, data: stored }
    } catch (err) {
      return reply.code(502).send({ success: false, error: tr('errors.files.uploadFailed', { err: String(err) }) })
    }
  })

  server.get(
    '/api/chat/attachments/:id',
    { preHandler: [app.authenticate], schema: { params: AttachmentIdParamsSchema, querystring: AttachmentQuerySchema } },
    async (req, reply) => {
      const file = await readAttachment(req.me.id, req.params.id, req.query.download === '1', req.query.size === 'thumb')
      if (!file) return reply.code(404).send({ success: false, error: tr('errors.chat.attachmentNotFound') })
      if (file.kind === 'redirect') return reply.redirect(file.url, 302)
      reply.header('X-Content-Type-Options', 'nosniff')
      // An attachment never changes after upload, so the phone keeps it for good instead of
      // pulling every photo from R2 through the VPS again each day.
      reply.header('Cache-Control', 'private, max-age=31536000, immutable')
      reply.header('Content-Disposition', `${file.inline && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${file.filename.replace(/"/g, "'")}"`)
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
 */
async function notifyMembers(
  conversationId: string,
  message: { authorUserId: string; body: string; refs: { card: { title: string } }[] },
): Promise<void> {
  try {
    const target = await service.pushTarget(conversationId, message.authorUserId)
    if (!target) return
    const offline = target.recipients.filter((userId) => !hasOpenConnection(userId))
    if (offline.length === 0) return

    // A message with only a shared object reads as the object's title.
    const text = message.body.trim() || (message.refs[0]?.card.title ?? '')
    const summary = text.length > PUSH_BODY_MAX ? `${text.slice(0, PUSH_BODY_MAX)}…` : text
    await notifyPush(
      'mesaje',
      (locale) => ({
        title: target.title,
        body:
          target.kind === 'group'
            ? summary
              ? `${target.byline}: ${summary}`
              : target.byline
            : summary || trFor(locale, 'push.chat.attachment'),
        url: `/messages/${conversationId}`,
      }),
      offline,
    )
  } catch (err) {
    // Pushul e canal suplimentar, nu condiție pentru trimiterea mesajului (regula #7).
    console.error(`[chat] push pentru ${conversationId} eșuat: ${String(err)}`)
  }
}
