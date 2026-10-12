import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { CompleteGoalSchema, CreatePlanGoalSchema, ReorderGoalsSchema, UpdatePlanGoalSchema } from './schema.js'
import * as service from './service.js'

export async function planRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/plan', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await service.getPlan(req.me) }
  })

  server.post(
    '/api/plan',
    { preHandler: [app.authenticate], schema: { body: CreatePlanGoalSchema } },
    async (req, reply) => {
      const row = await service.createGoal(req.me, req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.patch(
    '/api/plan/:id',
    { preHandler: [app.authenticate], schema: { body: UpdatePlanGoalSchema } },
    async (req, reply) => {
      try {
        const row = await service.updateGoal(req.me, (req.params as { id: string }).id, req.body)
        if (!row) return reply.code(404).send({ success: false, error: 'Goal inexistent' })
        return { success: true, data: row }
      } catch (err) {
        if (err instanceof service.ThresholdValueRequiredError) {
          return reply.code(400).send({ success: false, error: 'thresholdValue obligatoriu pt. thresholdType=mrr_ron' })
        }
        throw err
      }
    },
  )

  server.delete('/api/plan/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteGoal(req.me, (req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: 'Goal inexistent' })
    return { success: true }
  })

  server.patch(
    '/api/plan/:id/complete',
    { preHandler: [app.authenticate], schema: { body: CompleteGoalSchema } },
    async (req, reply) => {
      const row = await service.setCompleted(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: 'Goal inexistent' })
      return { success: true, data: row }
    },
  )

  server.post(
    '/api/plan/reorder',
    { preHandler: [app.authenticate], schema: { body: ReorderGoalsSchema } },
    async (req, reply) => {
      try {
        const rows = await service.reorderGoals(req.me, req.body.scope, req.body.tier, req.body.orderedIds)
        return { success: true, data: rows }
      } catch (err) {
        if (err instanceof service.InvalidReorderError) {
          return reply.code(400).send({ success: false, error: err.message })
        }
        throw err
      }
    },
  )
}
