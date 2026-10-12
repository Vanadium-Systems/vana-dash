import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../shared/config.js'
import { requireIngestToken } from '../../shared/middleware/auth.js'
import { EquityQuerySchema, JeffbotSnapshotSchema, OverviewQuerySchema, ReviewIdParamsSchema } from './schema.js'
import { getEquity, getOverview, getReview, ingestSnapshot } from './service.js'

export async function jeffbotRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Called by the bot's export every 5 minutes, not by a browser session. Fail-closed like
  // host-metrics: without the token in env, every request gets 401.
  server.post(
    '/api/v1/integrations/jeffbot/snapshot',
    {
      bodyLimit: 2 * 1024 * 1024,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      onRequest: requireIngestToken('X-Ingest-Token', () => config.jeffbotIngestToken, 'JEFFBOT_INGEST_TOKEN'),
      schema: { body: JeffbotSnapshotSchema },
    },
    async (req) => {
      await ingestSnapshot(req.body)
      return { success: true }
    },
  )

  server.get(
    '/api/jeffbot/overview',
    { preHandler: [app.authenticate], schema: { querystring: OverviewQuerySchema } },
    async (req) => {
      return { success: true, data: await getOverview(req.query.market) }
    },
  )

  server.get('/api/jeffbot/equity', { preHandler: [app.authenticate], schema: { querystring: EquityQuerySchema } }, async (req) => {
    return { success: true, data: await getEquity(req.query.days, req.query.market) }
  })

  server.get(
    '/api/jeffbot/reviews/:id',
    { preHandler: [app.authenticate], schema: { params: ReviewIdParamsSchema } },
    async (req, reply) => {
      const review = await getReview(req.params.id)
      if (!review) return reply.code(404).send({ success: false, error: 'Raport inexistent' })
      return { success: true, data: review }
    },
  )
}
