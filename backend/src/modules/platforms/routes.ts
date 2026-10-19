import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { connectors } from '../../connectors/index.js'
import { rescheduleSyncJobs, triggerSyncNow } from '../../jobs/sync-runner.js'
import { PlatformCreateSchema, PlatformIdParamsSchema, PlatformUpdateSchema } from './schema.js'
import * as service from './service.js'
import { assertResolvesToPublicAddress, SsrfBlockedError } from '../../shared/lib/ssrf-guard.js'

export async function platformRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/platforms', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listPlatforms() }
  })

  server.get('/api/platforms/types', { preHandler: [app.authenticate] }, async () => {
    const data = Object.values(connectors).map((c) => ({ type: c.type, displayName: c.displayName }))
    return { success: true, data }
  })

  server.get(
    '/api/platforms/:id',
    { preHandler: [app.authenticate], schema: { params: PlatformIdParamsSchema } },
    async (req, reply) => {
      const platform = await service.getPlatform(req.params.id)
      if (!platform) return reply.code(404).send({ success: false, error: 'Platform not found' })
      return { success: true, data: platform }
    },
  )

  server.post(
    '/api/platforms',
    { preHandler: [app.authenticate], schema: { body: PlatformCreateSchema } },
    async (req, reply) => {
      if (!connectors[req.body.type]) {
        return reply.code(400).send({ success: false, error: `Unknown platform type: ${req.body.type}` })
      }
      try {
        await assertResolvesToPublicAddress(req.body.apiUrl)
      } catch (err) {
        if (err instanceof SsrfBlockedError) return reply.code(400).send({ success: false, error: err.message })
        throw err
      }
      const platform = await service.createPlatform(req.body)
      await rescheduleSyncJobs()
      return reply.code(201).send({ success: true, data: platform })
    },
  )

  server.patch(
    '/api/platforms/:id',
    {
      preHandler: [app.authenticate],
      schema: { params: PlatformIdParamsSchema, body: PlatformUpdateSchema },
    },
    async (req, reply) => {
      if (req.body.type && !connectors[req.body.type]) {
        return reply.code(400).send({ success: false, error: `Unknown platform type: ${req.body.type}` })
      }
      if (req.body.apiUrl) {
        try {
          await assertResolvesToPublicAddress(req.body.apiUrl)
        } catch (err) {
          if (err instanceof SsrfBlockedError) return reply.code(400).send({ success: false, error: err.message })
          throw err
        }
      }
      const platform = await service.updatePlatform(req.params.id, req.body)
      if (!platform) return reply.code(404).send({ success: false, error: 'Platform not found' })
      await rescheduleSyncJobs()
      return { success: true, data: platform }
    },
  )

  server.delete(
    '/api/platforms/:id',
    { preHandler: [app.authenticate], schema: { params: PlatformIdParamsSchema } },
    async (req, reply) => {
      const deleted = await service.softDeletePlatform(req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Platform not found' })
      await rescheduleSyncJobs()
      return { success: true }
    },
  )

  server.post(
    '/api/platforms/:id/sync',
    { preHandler: [app.authenticate], schema: { params: PlatformIdParamsSchema } },
    async (req, reply) => {
      const platform = await service.getPlatform(req.params.id)
      if (!platform) return reply.code(404).send({ success: false, error: 'Platform not found' })
      await triggerSyncNow(req.params.id)
      return { success: true, data: await service.listSyncLog(req.params.id, 1) }
    },
  )

  server.get(
    '/api/platforms/:id/sync-log',
    { preHandler: [app.authenticate], schema: { params: PlatformIdParamsSchema } },
    async (req, reply) => {
      const platform = await service.getPlatform(req.params.id)
      if (!platform) return reply.code(404).send({ success: false, error: 'Platform not found' })
      return { success: true, data: await service.listSyncLog(req.params.id) }
    },
  )

  server.get(
    '/api/platforms/:id/ops-signals',
    { preHandler: [app.authenticate], schema: { params: PlatformIdParamsSchema } },
    async (req, reply) => {
      try {
        const result = await service.getPlatformOpsSignals(req.params.id)
        if (!result.found) return reply.code(404).send({ success: false, error: 'Platform not found' })
        if (!result.supported) return { success: true, data: { supported: false, signals: [], history: [] } }
        return { success: true, data: { supported: true, ...result.data } }
      } catch (err) {
        if (err instanceof service.OpsSignalsFetchError) {
          return reply.code(502).send({ success: false, error: err.message })
        }
        throw err
      }
    },
  )
}
