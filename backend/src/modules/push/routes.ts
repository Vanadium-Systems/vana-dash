import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../shared/config.js'
import { DeviceTokenSchema, SubscribeSchema, UnsubscribeSchema, UpdatePreferencesSchema } from './schema.js'
import * as service from './service.js'

export async function pushRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Auth pe toate rutele (CLAUDE.md #6) — inclusiv cheia publică, single-user, nimic de expus
  // fără sesiune validă.
  server.get('/api/push/vapid-public-key', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: { publicKey: config.vapid.publicKey } }
  })

  server.post(
    '/api/push/subscribe',
    { preHandler: [app.authenticate], schema: { body: SubscribeSchema } },
    async (req, reply) => {
      const row = await service.subscribe(req.me, req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.delete(
    '/api/push/subscribe',
    { preHandler: [app.authenticate], schema: { body: UnsubscribeSchema } },
    async (req) => {
      const row = await service.unsubscribe(req.me, req.body.endpoint)
      return { success: true, data: row ?? null }
    },
  )

  server.get('/api/push/preferences', { preHandler: [app.authenticate] }, async () => {
    const prefs = await service.getPreferences()
    return { success: true, data: prefs }
  })

  server.put(
    '/api/push/preferences',
    { preHandler: [app.authenticate], schema: { body: UpdatePreferencesSchema } },
    async (req) => {
      const prefs = await service.updatePreferences(req.body)
      return { success: true, data: prefs }
    },
  )

  server.post('/api/push/test', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const result = await service.sendTest()
      return { success: true, data: result }
    } catch (err) {
      return reply.code(400).send({ success: false, error: String((err as Error).message ?? err) })
    }
  })

  // Canal nativ APK (FCM, Contract C) — token-ul se înregistrează după login, se șterge la logout.
  server.post('/api/push/device', { preHandler: [app.authenticate], schema: { body: DeviceTokenSchema } }, async (req) => {
    await service.registerDevice(req.me, req.body)
    return { success: true }
  })

  server.delete('/api/push/device', { preHandler: [app.authenticate], schema: { body: DeviceTokenSchema } }, async (req) => {
    const result = await service.unregisterDevice(req.me, req.body)
    return { success: true, data: result }
  })
}
