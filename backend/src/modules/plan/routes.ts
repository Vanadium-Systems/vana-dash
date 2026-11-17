import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { CompleteGoalSchema, CreatePlanGoalSchema, ReorderGoalsSchema, MoveGoalSchema, UpdatePlanGoalSchema } from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'
import { fail } from '../../shared/lib/http-error.js'

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
        if (!row) return fail(reply, 404, 'GOAL_NOT_FOUND', { message: tr('errors.plan.goalNotFound') })
        return { success: true, data: row }
      } catch (err) {
        if (err instanceof service.ThresholdValueRequiredError) {
          return fail(reply, 400, 'GOAL_THRESHOLD_REQUIRED', { message: tr('errors.plan.thresholdRequired') })
        }
        throw err
      }
    },
  )

  server.delete('/api/plan/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteGoal(req.me, (req.params as { id: string }).id)
    if (!row) return fail(reply, 404, 'GOAL_NOT_FOUND', { message: tr('errors.plan.goalNotFound') })
    return { success: true }
  })

  server.patch(
    '/api/plan/:id/complete',
    { preHandler: [app.authenticate], schema: { body: CompleteGoalSchema } },
    async (req, reply) => {
      const row = await service.setCompleted(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return fail(reply, 404, 'GOAL_NOT_FOUND', { message: tr('errors.plan.goalNotFound') })
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
          return fail(reply, 400, 'GOAL_ORDER_MISMATCH', { message: err.message })
        }
        throw err
      }
    },
  )

  server.patch(
    '/api/plan/:id/move',
    { preHandler: [app.authenticate], schema: { body: MoveGoalSchema } },
    async (req, reply) => {
      const row = await service.moveGoal(req.me, (req.params as { id: string }).id, req.body.tier, req.body.position)
      if (!row) return fail(reply, 404, 'GOAL_NOT_FOUND', { message: tr('errors.plan.goalNotFound') })
      return { success: true, data: row }
    },
  )
}
