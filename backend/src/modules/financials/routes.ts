import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { resolvePeriod } from '../../shared/lib/period.js'
import { ExchangeRateQuerySchema, PeriodQuerySchema } from './schema.js'
import * as service from './service.js'
import { displayMoney, fromRon, moneyMeta } from '../../shared/lib/display-money.js'

export async function financialsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/financials/pnl',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return { success: true, data: await service.getPnl(range), money: await moneyMeta() }
    },
  )

  server.get(
    '/api/financials/cashflow',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return { success: true, data: await service.getCashflow(range), money: await moneyMeta() }
    },
  )

  server.get(
    '/api/financials/revenue-series',
    { preHandler: [app.authenticate], schema: { querystring: PeriodQuerySchema } },
    async (req) => {
      const range = resolvePeriod(req.query.period, req.query.from, req.query.to)
      return { success: true, data: await service.getRevenueSeries(range), money: await moneyMeta() }
    },
  )

  server.get('/api/financials/recurring-revenue', { preHandler: [app.authenticate] }, async () => {
    // MRR is a current value, not a dated row: it is shown at the latest rate.
    const [mrr, money] = await Promise.all([service.getRecurringRevenue(), displayMoney()])
    return { success: true, data: { ...mrr, mrrDisplay: fromRon(mrr.mrrLei, money) }, money: await moneyMeta() }
  })

  server.get('/api/financials/recurring-expenses', { preHandler: [app.authenticate] }, async () => {
    const [expenses, money] = await Promise.all([service.getRecurringExpensesMonthly(), displayMoney()])
    return { success: true, data: { ...expenses, monthlyDisplay: fromRon(expenses.monthlyRon, money) }, money: await moneyMeta() }
  })

  server.get(
    '/api/financials/exchange-rates',
    { preHandler: [app.authenticate], schema: { querystring: ExchangeRateQuerySchema } },
    async (req) => {
      return { success: true, data: await service.getExchangeRateHistory(req.query) }
    },
  )
}
