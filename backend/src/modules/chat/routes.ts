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
  MessageIdParamsSchema,
  SendMessageSchema,
  UpdateConversationSchema,
} from './schema.js'
import * as service from './service.js'
import { ConversationForbiddenError, GroupPermissionError, MessageBodyError } from './service.js'
import { tr, trFor } from '../../shared/lib/i18n.js'

const HEARTBEAT_INTERVAL_MS = 25_000
// Mesajul apare și în notificarea push; trunchiem ca unul lung să nu umple bara de
// notificări a telefonului.
const PUSH_BODY_MAX = 140

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

  server.get('/api/chat/conversations', { preHandler: [app.authenticate] }, async (req) => {
    const list = await service.listConversations(req.me)
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
    async (req) => ({ success: true, data: await service.listMessages(req.me, req.params.id, req.query) }),
  )

  server.post(
    '/api/chat/conversations/:id/messages',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: SendMessageSchema } },
    async (req) => {
      const { id: conversationId } = req.params
      const message = await service.sendMessage(req.me, conversationId, req.body)
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

  // ── Mesaje ─────────────────────────────────────────────────────────────────

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
      const file = await readAttachment(req.me.id, req.params.id, req.query.download === '1')
      if (!file) return reply.code(404).send({ success: false, error: tr('errors.chat.attachmentNotFound') })
      if (file.kind === 'redirect') return reply.redirect(file.url, 302)
      reply.header('X-Content-Type-Options', 'nosniff')
      // Un atașament nu se schimbă după upload; fără cache, fiecare deschidere a firului
      // ar trage iar toate pozele din R2 prin VPS.
      reply.header('Cache-Control', 'private, max-age=86400')
      reply.header('Content-Disposition', `${file.inline && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${file.filename.replace(/"/g, "'")}"`)
      return reply.type(file.contentType).send(file.buffer)
    },
  )
}

/**
 * Push doar către oamenii fără conexiune SSE deschisă: cine are fluxul deschis primește
 * mesajul prin el în aceeași secundă, iar o notificare pe telefon ar fi doar duplicat.
 */
async function notifyMembers(conversationId: string, message: { authorUserId: string; body: string }): Promise<void> {
  try {
    const target = await service.pushTarget(conversationId, message.authorUserId)
    if (!target) return
    const offline = target.recipients.filter((userId) => !hasOpenConnection(userId))
    if (offline.length === 0) return

    const text = message.body.trim()
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
