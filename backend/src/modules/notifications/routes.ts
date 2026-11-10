import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { MarkReadSchema, NotificationsQuerySchema } from './schema.js'
import * as service from './service.js'

export async function notificationsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/notifications', { preHandler: [app.authenticate], schema: { querystring: NotificationsQuerySchema } }, async (req) => {
    return { success: true, data: await service.listNotifications(req.me, req.query.cursor) }
  })

  server.post('/api/notifications/read', { preHandler: [app.authenticate], schema: { body: MarkReadSchema } }, async (req) => {
    return { success: true, data: await service.markRead(req.me, req.body) }
  })
}
