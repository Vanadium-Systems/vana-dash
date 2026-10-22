import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  CallIdParamsSchema,
  CreateCallSchema,
  ListCallsQuerySchema,
  PublicCallParamsSchema,
  UpdateCallSchema,
} from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'

const CALL_ERROR_TEXT = {
  not_found: 'errors.calls.notFound',
  closed: 'errors.calls.closed',
  provider: 'errors.calls.providerError',
  not_configured: 'errors.calls.notConfigured',
} as const

function sendCallError(reply: FastifyReply, err: unknown) {
  if (err instanceof service.CallError) return reply.code(err.status).send({ success: false, error: tr(CALL_ERROR_TEXT[err.code]) })
  throw err
}

export async function callsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/calls',
    { preHandler: [app.authenticate], schema: { querystring: ListCallsQuerySchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.listCalls(req.query) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  server.post(
    '/api/calls',
    { preHandler: [app.authenticate], schema: { body: CreateCallSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await service.createCall(req.body) })
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  server.patch(
    '/api/calls/:id',
    { preHandler: [app.authenticate], schema: { params: CallIdParamsSchema, body: UpdateCallSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.updateCall(req.params.id, req.body) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  server.post(
    '/api/calls/:id/join',
    { preHandler: [app.authenticate], schema: { params: CallIdParamsSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.joinCall(req.params.id, req.me) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  server.post(
    '/api/calls/:id/end',
    { preHandler: [app.authenticate], schema: { params: CallIdParamsSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.endCall(req.params.id) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  // The guest page has no account: it only answers the time window, rate limited per IP.
  server.get(
    '/api/public/calls/:publicId',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { params: PublicCallParamsSchema } },
    async (req, reply) => {
      const call = await service.getPublicCall(req.params.publicId)
      if (!call) return reply.code(404).send({ success: false, error: tr('errors.calls.notFound') })
      return { success: true, data: call }
    },
  )
}
