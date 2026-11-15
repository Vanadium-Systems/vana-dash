import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { MetaRoutesQuerySchema } from './schema.js'
import { listCallableRoutes } from './service.js'

export async function metaRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/meta/routes',
    { preHandler: [app.authenticate], schema: { querystring: MetaRoutesQuerySchema } },
    async (req) => ({
      success: true,
      data: listCallableRoutes(app.featureGuard, req.me.features, req.apiToken !== null, req.query.filter),
    }),
  )
}
