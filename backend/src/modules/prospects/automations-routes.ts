import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { fail } from '../../shared/lib/http-error.js'
import { tr } from '../../shared/lib/i18n.js'
import { AutomationParamsSchema, UpdateAutomationSchema } from './automations-schema.js'
import * as automations from './automations-service.js'

export function automationsErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof automations.AutomationForbiddenError) return fail(reply, 403, err.code, { message: tr('errors.prospects.automationForbidden') })
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
      if (!params) return fail(reply, 400, 'AUTOMATION_PARAMS_INVALID', { message: tr('errors.prospects.automationParams') })
      return { success: true, data: await automations.saveAutomation(req.params.ruleKey, req.body.enabled, params) }
    } catch (err) {
      return automationsErrorReply(reply, err)
    }
  })
}
