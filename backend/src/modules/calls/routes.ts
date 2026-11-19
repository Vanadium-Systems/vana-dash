import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  CallIdParamsSchema,
  CreateCallSchema,
  ExtendCallSchema,
  ListCallsQuerySchema,
  PublicCallParamsSchema,
  PublicCallTokenBodySchema,
  ScreenShareBodySchema,
  UpdateCallSchema,
} from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'
import { fail } from '../../shared/lib/http-error.js'

const CALL_ERROR = {
  not_found: { code: 'CALL_NOT_FOUND', text: 'errors.calls.notFound' },
  closed: { code: 'CALL_CLOSED', text: 'errors.calls.closed' },
  provider: { code: 'CALLS_PROVIDER_FAILED', text: 'errors.calls.providerError' },
  not_configured: { code: 'CALLS_NOT_CONFIGURED', text: 'errors.calls.notConfigured' },
  forbidden: { code: 'FORBIDDEN', text: 'errors.forbidden' },
} as const

function sendCallError(reply: FastifyReply, err: unknown) {
  if (err instanceof service.CallError) {
    if (err.code === 'forbidden' && err.feature) {
      return fail(reply, 403, 'FEATURE_FORBIDDEN', { details: { feature: err.feature } })
    }
    const { code, text } = CALL_ERROR[err.code]
    return fail(reply, err.status, code, { message: tr(text) })
  }
  throw err
}

export async function callsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/calls',
    { preHandler: [app.authenticate], schema: { querystring: ListCallsQuerySchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.listCalls(req.me, req.query) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  server.get('/api/calls/status', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getCallsStatus() }
  })

  server.post(
    '/api/calls',
    { preHandler: [app.authenticate], schema: { body: CreateCallSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await service.createCall(req.me, req.body) })
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
        return { success: true, data: await service.updateCall(req.me, req.params.id, req.body) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  server.post(
    '/api/calls/:id/token',
    { preHandler: [app.authenticate], schema: { params: CallIdParamsSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.issueCallToken(req.params.id, req.me) }
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
    '/api/calls/:id/screen-share',
    { preHandler: [app.authenticate], schema: { params: CallIdParamsSchema, body: ScreenShareBodySchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.setScreenShare(req.me, req.params.id, req.body) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )

  server.post(
    '/api/calls/:id/extend',
    { preHandler: [app.authenticate], schema: { params: CallIdParamsSchema, body: ExtendCallSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.extendCall(req.me, req.params.id, req.body.hours) }
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
        return { success: true, data: await service.endCall(req.me, req.params.id) }
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
      if (!call) return fail(reply, 404, 'CALL_NOT_FOUND', { message: tr('errors.calls.notFound') })
      return { success: true, data: call }
    },
  )

  server.post(
    '/api/public/calls/:publicId/token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: PublicCallParamsSchema, body: PublicCallTokenBodySchema },
    },
    async (req, reply) => {
      try {
        return { success: true, data: await service.issuePublicCallToken(req.params.publicId, req.body.guestName) }
      } catch (err) {
        return sendCallError(reply, err)
      }
    },
  )
}
