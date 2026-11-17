import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  AnalyticsSettingsSchema,
  CompanySettingsUpdateSchema,
  LiveKitSettingsUpdateSchema,
  LiveKitTestSchema,
  NavLayoutUpdateSchema,
  OpsJobTogglesUpdateSchema,
} from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'
import { fail } from '../../shared/lib/http-error.js'

export async function settingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/settings/nav-layout', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: { items: await service.getNavLayout() } }
  })

  server.put(
    '/api/settings/nav-layout',
    { preHandler: [app.authenticate], schema: { body: NavLayoutUpdateSchema } },
    async (req) => {
      const items = await service.setNavLayout(req.body)
      return { success: true, data: { items } }
    },
  )

  server.get('/api/settings/company-profile', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getCompanySettings() }
  })

  server.put(
    '/api/settings/company-profile',
    { preHandler: [app.authenticate], schema: { body: CompanySettingsUpdateSchema } },
    async (req) => {
      return { success: true, data: await service.setCompanySettings(req.body) }
    },
  )

  server.get('/api/settings/ops-jobs', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getOpsJobToggles() }
  })

  server.put(
    '/api/settings/ops-jobs',
    { preHandler: [app.authenticate], schema: { body: OpsJobTogglesUpdateSchema } },
    async (req) => {
      return { success: true, data: await service.setOpsJobToggles(req.body) }
    },
  )

  server.get('/api/settings/analytics', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getAnalyticsSettings() }
  })

  server.put(
    '/api/settings/analytics',
    { preHandler: [app.authenticate], schema: { body: AnalyticsSettingsSchema } },
    async (req) => {
      return { success: true, data: await service.setAnalyticsSettings(req.body) }
    },
  )

  // Every signed-in person loads PostHog with the company's key, so this one is `self`.
  server.get('/api/analytics/client-config', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getAnalyticsClientConfig() }
  })

  server.get('/api/settings/livekit', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getLiveKitSettingsView() }
  })

  server.put(
    '/api/settings/livekit',
    { preHandler: [app.authenticate], schema: { body: LiveKitSettingsUpdateSchema } },
    async (req) => {
      return { success: true, data: await service.saveLiveKitSettings(req.body) }
    },
  )

  server.post(
    '/api/settings/livekit/test',
    { preHandler: [app.authenticate], schema: { body: LiveKitTestSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.testLiveKitConnection(req.body) }
      } catch (err) {
        if (err instanceof service.LiveKitError) {
          return fail(reply, err.status === 0 ? 400 : 502, 'CALLS_PROVIDER_FAILED', { message: tr('errors.calls.providerError') })
        }
        throw err
      }
    },
  )
}
