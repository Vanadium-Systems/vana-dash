import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { resolveComparePeriod, resolvePeriod } from '../../shared/lib/period.js'
import { OverviewConfigUpdateSchema, PeriodQuerySchema, SeriesQuerySchema } from './schema.js'
import * as service from './service.js'
import { moneyMeta } from '../../shared/lib/display-money.js'

export async function metricRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/metrics/summary',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      const data = await service.getSummary(range, req.query.platformId)
      if (!req.query.compare) return { success: true, data, money: await moneyMeta() }
      const previousRange = resolveComparePeriod(range, req.query.compare, req.query.period)
      // `data` stays the array it always was; the compared rows come next to it.
      const previous = await service.getSummary(previousRange, req.query.platformId)
      return { success: true, data, previous, money: await moneyMeta() }
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
        money: await moneyMeta(),
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
