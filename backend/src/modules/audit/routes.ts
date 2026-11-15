import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { AuditQuerySchema } from './schema.js'
import { listAudit } from './service.js'

// „Cine a făcut ce" (PLAN.md C2). Funcționalitatea `echipa.istoric` — nu „doar Vanadium":
// orice om din echipă vede istoricul, fiindcă toată povestea e despre obiectele comune.
//
// Paginare pe cursor pe `created_at`: lista crește continuu, iar cu offset s-ar sări rânduri
// la inserări între două pagini.

export async function auditRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/audit', { preHandler: [app.authenticate], schema: { querystring: AuditQuerySchema } }, async (req) => {
    return { success: true, data: await listAudit(req.me, req.query) }
  })
}
