import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { BoardColumnQuerySchema, BoardQuerySchema, ByAgentQuerySchema, ForecastQuerySchema, FunnelQuerySchema } from './pipeline-schema.js'
import * as pipeline from './pipeline-service.js'

// Static paths win over `/api/prospects/:id`; all GET, so `clienti.view` covers them in the catalog.
export async function prospectPipelineRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }

  server.get('/api/prospects/board', { ...auth, schema: { querystring: BoardQuerySchema } }, async (req) => {
    return { success: true, data: await pipeline.getBoard(req.me, req.query) }
  })

  server.get('/api/prospects/board/column', { ...auth, schema: { querystring: BoardColumnQuerySchema } }, async (req) => {
    return { success: true, data: await pipeline.getBoardColumn(req.me, req.query) }
  })

  server.get('/api/prospects/forecast', { ...auth, schema: { querystring: ForecastQuerySchema } }, async (req) => {
    return { success: true, data: await pipeline.getForecast(req.me, req.query) }
  })

  server.get('/api/prospects/funnel', { ...auth, schema: { querystring: FunnelQuerySchema } }, async (req) => {
    return { success: true, data: await pipeline.getFunnel(req.me, req.query) }
  })

  server.get('/api/prospects/stats/by-agent', { ...auth, schema: { querystring: ByAgentQuerySchema } }, async (req) => {
    return { success: true, data: await pipeline.getStatsByAgent(req.me, req.query) }
  })
}
