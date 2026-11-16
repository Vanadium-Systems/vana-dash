import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { HomeLayoutBodySchema } from './schema.js'
import * as service from './service.js'
import { LayoutForbiddenError } from './service.js'

export async function overviewRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof LayoutForbiddenError) return reply.code(400).send({ success: false, error: error.message })
    throw error
  })

  server.get('/api/dashboard/layout', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.getHomeLayout(req.me),
  }))

  server.put(
    '/api/dashboard/layout',
    { preHandler: [app.authenticate], schema: { body: HomeLayoutBodySchema } },
    async (req) => {
      await service.setOwnLayout(req.me, req.body.layout)
      return { success: true, data: await service.getHomeLayout(req.me) }
    },
  )

  server.delete('/api/dashboard/layout', { preHandler: [app.authenticate] }, async (req) => {
    await service.resetOwnLayout(req.me)
    return { success: true, data: await service.getHomeLayout(req.me) }
  })

  server.put(
    '/api/dashboard/layout/company',
    { preHandler: [app.authenticate], schema: { body: HomeLayoutBodySchema } },
    async (req) => {
      await service.setCompanyLayout(req.body.layout)
      return { success: true, data: await service.getHomeLayout(req.me) }
    },
  )
}
