import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { CompanyProfileSchema, NavLayoutUpdateSchema, OpsJobTogglesUpdateSchema } from './schema.js'
import * as service from './service.js'

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
    return { success: true, data: { profile: await service.getCompanyProfile() } }
  })

  server.put(
    '/api/settings/company-profile',
    { preHandler: [app.authenticate], schema: { body: CompanyProfileSchema } },
    async (req) => {
      const profile = await service.setCompanyProfile(req.body)
      return { success: true, data: { profile } }
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
}
