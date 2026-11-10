import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import { AutomationParamsSchema, UpdateAutomationSchema } from './automations-schema.js'
import * as automations from './automations-service.js'

export function automationsErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof automations.AutomationForbiddenError) return reply.code(403).send({ success: false, error: tr('errors.prospects.automationForbidden'), code: err.code })
  throw err
}

/** The six fixed rules; registered by `prospectsRoutes`. PUT is `clienti.prospectare` in the catalog, narrowed here. */
export async function automationsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }

  server.get('/api/prospects/automations', auth, async () => ({ success: true, data: await automations.listAutomations() }))

  server.put('/api/prospects/automations/:ruleKey', { ...auth, schema: { params: AutomationParamsSchema, body: UpdateAutomationSchema } }, async (req, reply) => {
    try {
      automations.assertCanConfigureAutomations(req.me)
      const params = automations.parseRuleParams(req.params.ruleKey, req.body.params)
      if (!params) return reply.code(400).send({ success: false, error: tr('errors.prospects.automationParams') })
      return { success: true, data: await automations.saveAutomation(req.params.ruleKey, req.body.enabled, params) }
    } catch (err) {
      return automationsErrorReply(reply, err)
    }
  })
}
