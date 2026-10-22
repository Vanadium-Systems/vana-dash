import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import * as service from './service.js'
import {
  CreateTenantSchema,
  TenantFeatureBodySchema,
  TenantFeatureParamsSchema,
  TenantIdParamsSchema,
  UpdateTenantSchema,
} from './schema.js'
import { tr, type TrKey } from '../../shared/lib/i18n.js'

const ERROR_TEXT: Record<service.TenantError['code'], TrKey> = {
  not_found: 'errors.tenants.notFound',
  rls_required: 'errors.tenants.rlsRequired',
  slug_taken: 'errors.tenants.slugTaken',
  owner_locked: 'errors.tenants.ownerLocked',
  feature_owner_only: 'errors.tenants.featureOwnerOnly',
  unknown_feature: 'errors.tenants.unknownFeature',
}

// The feature key lives on the request, not on the error, so the route hands it in.
const sendTenantError = (reply: FastifyReply, err: service.TenantError, featureKey?: string) =>
  reply.code(err.status).send({
    success: false,
    error: {
      code: err.code.toUpperCase(),
      message: tr(ERROR_TEXT[err.code], featureKey === undefined ? undefined : { feature: featureKey }),
    },
  })

export async function tenantsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof service.TenantError) return sendTenantError(reply, error)
    throw error
  })

  // `/api/platform/*` routes have no catalog feature: they belong to the platform account.
  // For anyone else they do not exist (404, not 403).
  const platformOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.me.isPlatformAdmin) return reply.code(404).send({ success: false, error: tr('errors.tenants.notFound') })
  }

  server.get('/api/platform/tenants', { preHandler: [app.authenticate, platformOnly] }, async () => ({
    success: true,
    data: await service.listTenants(),
  }))

  server.post(
    '/api/platform/tenants',
    { preHandler: [app.authenticate, platformOnly], schema: { body: CreateTenantSchema } },
    async (req, reply) => reply.code(201).send({ success: true, data: await service.createTenant(req.body) }),
  )

  server.patch(
    '/api/platform/tenants/:id',
    { preHandler: [app.authenticate, platformOnly], schema: { params: TenantIdParamsSchema, body: UpdateTenantSchema } },
    async (req) => ({ success: true, data: await service.updateTenantStatus(req.params.id, req.body.status) }),
  )

  server.put(
    '/api/platform/tenants/:id/features/:key',
    {
      preHandler: [app.authenticate, platformOnly],
      schema: { params: TenantFeatureParamsSchema, body: TenantFeatureBodySchema },
    },
    async (req, reply) => {
      try {
        const features = await service.setTenantFeature(req.params.id, req.params.key, req.body.enabled)
        return { success: true, data: { features } }
      } catch (err) {
        if (err instanceof service.TenantError) return sendTenantError(reply, err, req.params.key)
        throw err
      }
    },
  )
}
