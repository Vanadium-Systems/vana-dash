import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { resolvePeriod } from '../../shared/lib/period.js'
import { OverviewConfigUpdateSchema, PeriodQuerySchema, SeriesQuerySchema } from './schema.js'
import * as service from './service.js'

export async function metricRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/metrics/summary',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return { success: true, data: await service.getSummary(range, req.query.platformId) }
    },
  )

  server.get(
    '/api/metrics/series',
    { preHandler: [app.authenticate], schema: { querystring: SeriesQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return {
        success: true,
        data: await service.getSeries(req.query.metricKey, range, req.query.platformId),
      }
    },
  )

  server.get('/api/metrics/overview-config', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getOverviewConfig() }
  })

  server.put(
    '/api/metrics/overview-config',
    { preHandler: [app.authenticate], schema: { body: OverviewConfigUpdateSchema } },
    async (req) => {
      await service.setOverviewConfig(req.body.visibleKpis)
      return { success: true, data: { visibleKpis: req.body.visibleKpis } }
    },
  )
}
