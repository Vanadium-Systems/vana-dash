import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { AccessError, getCatalog, getMatrix, createRole, renameRole, deleteRole, setRoleFeature, setRolePage } from './service.js'
import { CreateRoleSchema, RenameRoleSchema, RoleFeatureSchema } from './schema.js'

// Toate rutele de aici cer `echipa.administrare` (vezi shared/lib/features.ts) — guardul e
// comun, deci niciuna nu are nevoie de un `requireFeature` repetat.

export async function accessRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Erorile de acces au coduri stabile (FEATURE_NOT_IN_TENANT, PERMISSION_ESCALATION,
  // ROLE_IN_USE, ROLE_LOCKED), pe care frontendul le traduce; motivul vine ca text.
  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof AccessError) {
      return reply.code(error.status).send({ success: false, error: { code: error.code, message: error.message } })
    }
    throw error
  })

  server.get('/api/access/catalog', { preHandler: [app.authenticate] }, async () => ({
    success: true,
    data: getCatalog(),
  }))

  server.get('/api/access/matrix', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await getMatrix(req.me),
  }))

  server.post('/api/access/roles', { preHandler: [app.authenticate], schema: { body: CreateRoleSchema } }, async (req, reply) => {
    const role = await createRole(req.me, req.body)
    return reply.code(201).send({ success: true, data: role })
  })

  server.patch('/api/access/roles/:id', { preHandler: [app.authenticate], schema: { body: RenameRoleSchema } }, async (req) => ({
    success: true,
    data: await renameRole(req.me, (req.params as { id: string }).id, req.body.name),
  }))

  server.delete('/api/access/roles/:id', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await deleteRole(req.me, (req.params as { id: string }).id),
  }))

  server.put(
    '/api/access/roles/:id/features/:key',
    { preHandler: [app.authenticate], schema: { body: RoleFeatureSchema } },
    async (req) => {
      const { id, key } = req.params as { id: string; key: string }
      return { success: true, data: await setRoleFeature(req.me, id, key, req.body.enabled) }
    },
  )

  server.put(
    '/api/access/roles/:id/pages/:page',
    { preHandler: [app.authenticate], schema: { body: RoleFeatureSchema } },
    async (req) => {
      const { id, page } = req.params as { id: string; page: string }
      return { success: true, data: await setRolePage(req.me, id, page, req.body.enabled) }
    },
  )
}
