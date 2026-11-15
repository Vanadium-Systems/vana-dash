import type { FastifyInstance } from 'fastify'
import { PASSWORD_CONFIRM_REQUIRED, passwordConfirmRequired } from '../../shared/lib/sessions.js'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import * as service from './service.js'
import { ApiTokenIdParamsSchema, CreateApiTokenSchema } from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

const notFound = () => ({ success: false, error: tr('errors.apiTokens.notFound') })

export async function apiTokensRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/me/api-tokens', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await service.listOwnTokens(req.me.id) }
  })

  server.get('/api/me/api-tokens/features', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: service.ownFeatureLabels(req.me) }
  })

  server.post(
    '/api/me/api-tokens',
    { preHandler: [app.authenticate], schema: { body: CreateApiTokenSchema } },
    async (req, reply) => {
      if (passwordConfirmRequired(req.session)) return reply.code(403).send(PASSWORD_CONFIRM_REQUIRED)
      const created = await service.createToken(req.me, req.body)
      if (!created.ok) {
        if (created.reason === 'FEATURE_FORBIDDEN') {
          return reply.code(403).send({ success: false, error: { code: 'FEATURE_FORBIDDEN', feature: 'echipa.tokenuri' } })
        }
        return reply.code(400).send({ success: false, error: created.reason })
      }
      return reply.code(201).send({ success: true, data: { token: created.token, item: created.item } })
    },
  )

  server.delete(
    '/api/me/api-tokens/:id',
    { preHandler: [app.authenticate], schema: { params: ApiTokenIdParamsSchema } },
    async (req, reply) => {
      if (!(await service.revokeToken(req.params.id, req.me.id))) return reply.code(404).send(notFound())
      return { success: true, data: { id: req.params.id } }
    },
  )

  server.get('/api/admin/api-tokens', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listCompanyTokens() }
  })

  server.delete(
    '/api/admin/api-tokens/:id',
    { preHandler: [app.authenticate], schema: { params: ApiTokenIdParamsSchema } },
    async (req, reply) => {
      if (!(await service.revokeToken(req.params.id))) return reply.code(404).send(notFound())
      return { success: true, data: { id: req.params.id } }
    },
  )
}
