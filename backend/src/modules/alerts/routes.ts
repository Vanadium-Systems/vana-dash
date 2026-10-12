import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { AckBulkSchema, CreateAlertRuleSchema, ListAlertsQuerySchema, SnoozeAlertSchema, UpdateAlertRuleSchema } from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'

export async function alertsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Reguli ────────────────────────────────────────────────────────────────

  server.get('/api/alert-rules', { preHandler: [app.authenticate] }, async () => {
    const rows = await service.listAlertRules()
    return { success: true, data: rows }
  })

  server.post(
    '/api/alert-rules',
    { preHandler: [app.authenticate], schema: { body: CreateAlertRuleSchema } },
    async (req, reply) => {
      const row = await service.createAlertRule(req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.patch(
    '/api/alert-rules/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateAlertRuleSchema } },
    async (req, reply) => {
      const row = await service.updateAlertRule((req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.alerts.ruleNotFound') })
      return { success: true, data: row }
    },
  )

  server.delete('/api/alert-rules/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteAlertRule((req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: tr('errors.alerts.ruleNotFound') })
    return { success: true }
  })

  server.post('/api/alert-rules/:id/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const result = await service.testAlertRule((req.params as { id: string }).id)
    if (!result) return reply.code(404).send({ success: false, error: tr('errors.alerts.ruleNotFound') })
    return { success: true, data: result }
  })

  // ── Alerte ────────────────────────────────────────────────────────────────

  server.get(
    '/api/alerts',
    { preHandler: [app.authenticate], schema: { querystring: ListAlertsQuerySchema } },
    async (req) => {
      const rows = await service.listAlerts(req.query)
      return { success: true, data: rows }
    },
  )

  server.get('/api/alerts/active-count', { preHandler: [app.authenticate] }, async () => {
    const count = await service.countActiveAlerts()
    return { success: true, data: { count } }
  })

  server.patch('/api/alerts/:id/ack', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.ackAlert((req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: tr('errors.alerts.alertNotFound') })
    return { success: true, data: row }
  })

  server.patch(
    '/api/alerts/:id/snooze',
    { preHandler: [app.authenticate], schema: { body: SnoozeAlertSchema } },
    async (req, reply) => {
      const row = await service.snoozeAlert((req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.alerts.alertNotFound') })
      return { success: true, data: row }
    },
  )

  // Ack în masă + seria pt. sparkline (Contract F)
  server.post('/api/alerts/ack-bulk', { preHandler: [app.authenticate], schema: { body: AckBulkSchema } }, async (req) => {
    const acked = await service.ackBulk(req.body.ruleId)
    return { success: true, data: { acked } }
  })

  server.get('/api/alert-rules/:id/sparkline', { preHandler: [app.authenticate] }, async (req, reply) => {
    const result = await service.getRuleSparkline((req.params as { id: string }).id)
    if (!result) return reply.code(404).send({ success: false, error: tr('errors.alerts.ruleNotFound') })
    return { success: true, data: result }
  })
}
