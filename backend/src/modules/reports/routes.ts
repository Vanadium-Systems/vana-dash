import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  ExpenseBreakdownTrendQuerySchema,
  MonthlySnapshotQuerySchema,
  MrrTrendQuerySchema,
  PeriodComparisonQuerySchema,
} from './schema.js'
import * as service from './service.js'
import { moneyMeta } from '../../shared/lib/display-money.js'
import { fail } from '../../shared/lib/http-error.js'

export async function reportsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/reports/mrr-trend',
    { preHandler: [app.authenticate], schema: { querystring: MrrTrendQuerySchema } },
    async (req) => {
      const data = await service.getMrrTrend(req.query)
      return { success: true, data, money: await moneyMeta() }
    },
  )

  server.get(
    '/api/reports/period-comparison',
    { preHandler: [app.authenticate], schema: { querystring: PeriodComparisonQuerySchema } },
    async (req) => {
      const data = await service.getPeriodComparison(req.query)
      return { success: true, data, money: await moneyMeta() }
    },
  )

  server.get(
    '/api/reports/period-comparison/csv',
    { preHandler: [app.authenticate], schema: { querystring: PeriodComparisonQuerySchema } },
    async (req, reply) => {
      const comparison = await service.getPeriodComparison(req.query)
      return reply
        .type('text/csv')
        .header('Content-Disposition', 'attachment; filename="period-comparison.csv"')
        .send(service.periodComparisonToCsv(comparison, (await moneyMeta()).currency))
    },
  )

  server.get(
    '/api/reports/expense-breakdown-trend',
    { preHandler: [app.authenticate], schema: { querystring: ExpenseBreakdownTrendQuerySchema } },
    async (req) => {
      const data = await service.getExpenseBreakdownTrend(req.query)
      return { success: true, data, money: await moneyMeta() }
    },
  )

  server.get(
    '/api/reports/monthly-snapshot',
    { preHandler: [app.authenticate], schema: { querystring: MonthlySnapshotQuerySchema } },
    async (req) => {
      const data = await service.getMonthlySnapshot(req.query)
      return { success: true, data, money: await moneyMeta() }
    },
  )

  server.post(
    '/api/reports/monthly-snapshot/pdf',
    { preHandler: [app.authenticate], schema: { querystring: MonthlySnapshotQuerySchema } },
    async (req, reply) => {
      const pdf = await service.generateMonthlySnapshotPdf(req.query)
      if (!pdf) return fail(reply, 503, 'PDF_GENERATION_UNAVAILABLE')
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="raport-${req.query.month}.pdf"`)
        .send(pdf)
    },
  )
}
