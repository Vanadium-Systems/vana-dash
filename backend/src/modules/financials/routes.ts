import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { resolvePeriod } from '../../shared/lib/period.js'
import { ExchangeRateQuerySchema, PeriodQuerySchema } from './schema.js'
import * as service from './service.js'

export async function financialsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/financials/pnl',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return { success: true, data: await service.getPnl(range) }
    },
  )

  server.get(
    '/api/financials/cashflow',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return { success: true, data: await service.getCashflow(range) }
    },
  )

  server.get(
    '/api/financials/revenue-series',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return { success: true, data: await service.getRevenueSeries(range) }
    },
  )

  server.get('/api/financials/recurring-revenue', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getRecurringRevenue() }
  })

  server.get('/api/financials/recurring-expenses', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getRecurringExpensesMonthly() }
  })

  server.get(
    '/api/financials/exchange-rates',
    { preHandler: [app.authenticate], schema: { querystring: ExchangeRateQuerySchema } },
    async (req) => {
      return { success: true, data: await service.getExchangeRateHistory(req.query) }
    },
  )
}
