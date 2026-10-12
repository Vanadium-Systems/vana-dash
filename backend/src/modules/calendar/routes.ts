import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { CreateCalendarShareSchema, CreateEventSchema, ListOccurrencesQuerySchema, UpdateEventSchema } from './schema.js'
import * as service from './service.js'
import { CalendarAccessError } from './service.js'
import { tr } from '../../shared/lib/i18n.js'

export async function calendarRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof CalendarAccessError) {
      return reply.code(error.status).send({ success: false, error: { code: error.code, message: error.message } })
    }
    throw error
  })

  // Layer-ele de calendar: al meu + cele partajate cu mine, plus cine pot fi invitați.
  server.get('/api/calendar/calendars', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.listCalendars(req.me),
  }))

  server.post(
    '/api/calendar/events',
    { preHandler: [app.authenticate], schema: { body: CreateEventSchema } },
    async (req) => {
      const row = await service.createEvent(req.me, req.body)
      return { success: true, data: row }
    },
  )

  server.get(
    '/api/calendar/events',
    { preHandler: [app.authenticate], schema: { querystring: ListOccurrencesQuerySchema } },
    async (req) => {
      const rows = await service.listOccurrences(req.me, req.query.from, req.query.to)
      return { success: true, data: rows }
    },
  )

  server.patch(
    '/api/calendar/events/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateEventSchema } },
    async (req, reply) => {
      const row = await service.updateEvent(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.calendar.eventNotFound') })
      return { success: true, data: row }
    },
  )

  server.delete('/api/calendar/events/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteEvent(req.me, (req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: tr('errors.calendar.eventNotFound') })
    return { success: true }
  })

  // Share pe calendarul întreg al unui om — îl dă doar proprietarul sau adminul (service).
  server.post('/api/calendar/shares', { preHandler: [app.authenticate], schema: { body: CreateCalendarShareSchema } }, async (req, reply) => {
    const given = await service.setCalendarShare(req.me, req.body.ownerUserId, req.body.userId, req.body.level)
    return reply.code(201).send({ success: true, data: given })
  })

  server.delete(
    '/api/calendar/shares/:ownerUserId/:userId',
    { preHandler: [app.authenticate] },
    async (req) => {
      const { ownerUserId, userId } = req.params as { ownerUserId: string; userId: string }
      return { success: true, data: await service.removeCalendarShare(req.me, ownerUserId, userId) }
    },
  )
}