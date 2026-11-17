import type { FastifyInstance } from 'fastify'
import { passwordConfirmRequired } from '../../shared/lib/sessions.js'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import * as service from './service.js'
import { ApiTokenIdParamsSchema, CreateApiTokenSchema } from './schema.js'
import { tr } from '../../shared/lib/i18n.js'
import { fail } from '../../shared/lib/http-error.js'

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
      if (passwordConfirmRequired(req.session)) return fail(reply, 403, 'PASSWORD_CONFIRM_REQUIRED')
      const created = await service.createToken(req.me, req.body)
      if (!created.ok) {
        if (created.reason === 'FEATURE_FORBIDDEN') {
          return fail(reply, 403, 'FEATURE_FORBIDDEN', { details: { feature: 'echipa.tokenuri' } })
        }
        return fail(reply, 400, created.reason)
      }
      return reply.code(201).send({ success: true, data: { token: created.token, item: created.item } })
    },
  )

  server.delete(
    '/api/me/api-tokens/:id',
    { preHandler: [app.authenticate], schema: { params: ApiTokenIdParamsSchema } },
    async (req, reply) => {
      if (!(await service.revokeToken(req.params.id, req.me.id))) return fail(reply, 404, 'API_TOKEN_NOT_FOUND', { message: tr('errors.apiTokens.notFound') })
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
      if (!(await service.revokeToken(req.params.id))) return fail(reply, 404, 'API_TOKEN_NOT_FOUND', { message: tr('errors.apiTokens.notFound') })
      return { success: true, data: { id: req.params.id } }
    },
  )
}
