import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { CreateWatchRuleSchema, ListTendersQuerySchema, UpdateTenderSchema, UpdateWatchRuleSchema } from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'

export async function tendersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/tenders', { preHandler: [app.authenticate], schema: { querystring: ListTendersQuerySchema } }, async (req) => {
    const rows = await service.listTenderOpportunities(req.query)
    return { success: true, data: rows }
  })

  server.patch(
    '/api/tenders/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateTenderSchema } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id
      const row = req.body.dismissed ? await service.dismissTenderOpportunity(id) : await service.undismissTenderOpportunity(id)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.tenders.opportunityNotFound') })
      return { success: true, data: row }
    },
  )

  server.get('/api/tenders/watch-rules', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listWatchRules() }
  })

  server.post(
    '/api/tenders/watch-rules',
    { preHandler: [app.authenticate], schema: { body: CreateWatchRuleSchema } },
    async (req, reply) => {
      const row = await service.createWatchRule(req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.patch(
    '/api/tenders/watch-rules/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateWatchRuleSchema } },
    async (req, reply) => {
      const row = await service.updateWatchRule((req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.alerts.ruleNotFound') })
      return { success: true, data: row }
    },
  )

  server.delete('/api/tenders/watch-rules/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteWatchRule((req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: tr('errors.alerts.ruleNotFound') })
    return { success: true }
  })
}
