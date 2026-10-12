import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import * as service from './service.js'
import { CloseTicketSchema, CreateTicketSchema, PlatformListQuerySchema, ReplySchema, TicketIdParamsSchema } from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

// Built per request: the text is in the language of whoever asked.
const notFound = () => ({ success: false, error: tr('errors.support.ticketNotFound') })

export async function supportRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Rutele `/api/platform/*` nu au funcționalitate în catalog: nu se dau prin rol, țin de
  // contul de platformă. Pentru oricine altcineva nu există (404, nu 403).
  const platformOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.me.isPlatformAdmin) return reply.code(404).send(notFound())
  }

  // ── Tichetele mele ─────────────────────────────────────────────────────────────────────────

  server.get('/api/support/tickets', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await service.listTickets({ kind: 'author', userId: req.me.id }) }
  })

  server.get('/api/support/unread', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await service.unreadCounts(req.me.id, req.me.isPlatformAdmin) }
  })

  server.post(
    '/api/support/tickets',
    { preHandler: [app.authenticate], schema: { body: CreateTicketSchema } },
    async (req, reply) => {
      return reply.code(201).send({ success: true, data: await service.createTicket(req.me.id, req.body) })
    },
  )

  server.get(
    '/api/support/tickets/:id',
    { preHandler: [app.authenticate], schema: { params: TicketIdParamsSchema } },
    async (req, reply) => {
      const ticket = await service.getTicket({ kind: 'author', userId: req.me.id }, req.params.id)
      return ticket ? { success: true, data: ticket } : reply.code(404).send(notFound())
    },
  )

  server.post(
    '/api/support/tickets/:id/replies',
    { preHandler: [app.authenticate], schema: { params: TicketIdParamsSchema, body: ReplySchema } },
    async (req, reply) => {
      const ticket = await service.addReply({ kind: 'author', userId: req.me.id }, req.me.id, req.params.id, req.body.body)
      return ticket ? reply.code(201).send({ success: true, data: ticket }) : reply.code(404).send(notFound())
    },
  )

  server.patch(
    '/api/support/tickets/:id',
    { preHandler: [app.authenticate], schema: { params: TicketIdParamsSchema, body: CloseTicketSchema } },
    async (req, reply) => {
      const ticket = await service.setStatus({ kind: 'author', userId: req.me.id }, req.params.id, req.body.status)
      return ticket ? { success: true, data: ticket } : reply.code(404).send(notFound())
    },
  )

  // ── Toate tichetele, pentru contul de platformă ────────────────────────────────────────────

  server.get(
    '/api/platform/support/tickets',
    { preHandler: [app.authenticate, platformOnly], schema: { querystring: PlatformListQuerySchema } },
    async (req) => {
      return { success: true, data: await service.listTickets({ kind: 'platform' }, req.query.status) }
    },
  )

  server.get(
    '/api/platform/support/tickets/:id',
    { preHandler: [app.authenticate, platformOnly], schema: { params: TicketIdParamsSchema } },
    async (req, reply) => {
      const ticket = await service.getTicket({ kind: 'platform' }, req.params.id)
      return ticket ? { success: true, data: ticket } : reply.code(404).send(notFound())
    },
  )

  server.post(
    '/api/platform/support/tickets/:id/replies',
    { preHandler: [app.authenticate, platformOnly], schema: { params: TicketIdParamsSchema, body: ReplySchema } },
    async (req, reply) => {
      const ticket = await service.addReply({ kind: 'platform' }, req.me.id, req.params.id, req.body.body)
      return ticket ? reply.code(201).send({ success: true, data: ticket }) : reply.code(404).send(notFound())
    },
  )

  server.patch(
    '/api/platform/support/tickets/:id',
    { preHandler: [app.authenticate, platformOnly], schema: { params: TicketIdParamsSchema, body: CloseTicketSchema } },
    async (req, reply) => {
      const ticket = await service.setStatus({ kind: 'platform' }, req.params.id, req.body.status)
      return ticket ? { success: true, data: ticket } : reply.code(404).send(notFound())
    },
  )
}
