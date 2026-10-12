import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { config } from '../../shared/config.js'
import { requireIngestToken } from '../../shared/middleware/auth.js'
import {
  BlockBodySchema,
  BookingSettingsSchema,
  IdParamsSchema,
  PublicBookingBodySchema,
  PublicCancelBodySchema,
  RangeQuerySchema,
  SlotsQuerySchema,
} from './schema.js'
import * as service from './service.js'

// Rutele publice le cheamă doar Function-ul din vana-site, server-to-server (Turnstile e verificat
// acolo), cu X-Booking-Token. Browserul nu ajunge la ele: CORS-ul rămâne cel al aplicației.

function sendBookingError(reply: FastifyReply, err: unknown) {
  if (err instanceof service.BookingError) return reply.code(err.status).send({ success: false, error: err.code })
  throw err
}

export async function bookingRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const bookingToken = requireIngestToken('X-Booking-Token', () => config.bookingToken, 'BOOKING_TOKEN')

  // Validarea greșită răspunde 422 cu un cod stabil, fără detaliile zod (site-ul are propria validare).
  const publicErrorHandler = (error: Error & { validation?: unknown }, _req: unknown, reply: FastifyReply) => {
    if (error.validation) return reply.code(422).send({ success: false, error: 'validation' })
    throw error
  }

  server.get(
    '/api/v1/public/booking/slots',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      onRequest: bookingToken,
      schema: { querystring: SlotsQuerySchema },
      errorHandler: publicErrorHandler,
    },
    async (req) => ({ success: true, data: await service.getAvailableSlots(req.query.days) }),
  )

  server.post(
    '/api/v1/public/booking',
    {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      onRequest: bookingToken,
      schema: { body: PublicBookingBodySchema },
      errorHandler: publicErrorHandler,
    },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await service.createPublicBooking(req.body) })
      } catch (err) {
        return sendBookingError(reply, err)
      }
    },
  )

  server.post(
    '/api/v1/public/booking/cancel',
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      onRequest: bookingToken,
      schema: { body: PublicCancelBodySchema },
      errorHandler: publicErrorHandler,
    },
    async (req, reply) => {
      try {
        return { success: true, data: await service.cancelByToken(req.body.token) }
      } catch (err) {
        return sendBookingError(reply, err)
      }
    },
  )

  server.get('/api/booking/settings', { preHandler: [app.authenticate] }, async () => ({
    success: true,
    data: await service.getSettings(),
  }))

  server.put('/api/booking/settings', { preHandler: [app.authenticate], schema: { body: BookingSettingsSchema } }, async (req) => ({
    success: true,
    data: await service.saveSettings(req.body),
  }))

  server.get('/api/booking/preview', { preHandler: [app.authenticate], schema: { querystring: SlotsQuerySchema } }, async (req) => ({
    success: true,
    data: await service.getAvailableSlots(req.query.days),
  }))

  server.get('/api/booking/blocks', { preHandler: [app.authenticate], schema: { querystring: RangeQuerySchema } }, async (req) => ({
    success: true,
    data: await service.listBlocks(req.query.from, req.query.to),
  }))

  server.post('/api/booking/blocks', { preHandler: [app.authenticate], schema: { body: BlockBodySchema } }, async (req, reply) =>
    reply.code(201).send({ success: true, data: await service.createBlock(req.body) }),
  )

  server.delete('/api/booking/blocks/:id', { preHandler: [app.authenticate], schema: { params: IdParamsSchema } }, async (req, reply) => {
    if (!(await service.deleteBlock(req.params.id))) return reply.code(404).send({ success: false, error: 'Interval negăsit' })
    return { success: true }
  })

  server.get('/api/booking/bookings', { preHandler: [app.authenticate], schema: { querystring: RangeQuerySchema } }, async (req) => ({
    success: true,
    data: await service.listBookings(req.query.from, req.query.to),
  }))

  server.post(
    '/api/booking/bookings/:id/cancel',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: z.object({ notifyVisitor: z.boolean().default(true) }).default({}) } },
    async (req, reply) => {
      if (!(await service.cancelById(req.params.id, req.body.notifyVisitor))) {
        return reply.code(404).send({ success: false, error: 'Programare negăsită sau deja anulată' })
      }
      return { success: true }
    },
  )
}
