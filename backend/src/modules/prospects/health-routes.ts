import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { prospectErrorReply } from './routes.js'
import { DuplicatesQuerySchema, MergeBodySchema, MergePreviewQuerySchema } from './health-schema.js'
import * as health from './health-service.js'

function healthErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof health.MergeSameError) return reply.code(400).send({ success: false, error: tr('errors.prospects.mergeSame'), code: err.code })
  if (err instanceof health.MergeAlreadyMergedError) return reply.code(409).send({ success: false, error: tr('errors.prospects.mergeAlreadyMerged'), code: err.code })
  return prospectErrorReply(reply, err)
}

export async function prospectHealthRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }
  const notFound = (reply: FastifyReply) => reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
  // The catalog opens GETs under /api/prospects to `clienti.view`; the health tab is for whoever can edit.
  const denied = (me: Pick<SessionUser, 'features'>, reply: FastifyReply) => {
    if (me.features.includes('clienti.prospectare')) return false
    void reply.code(403).send({ success: false, error: tr('errors.prospects.healthForbidden') })
    return true
  }

  server.get('/api/prospects/health', auth, async (req, reply) => {
    if (denied(req.me, reply)) return reply
    return { success: true, data: await health.getHealth(req.me) }
  })

  server.get('/api/prospects/health/duplicates', { ...auth, schema: { querystring: DuplicatesQuerySchema } }, async (req, reply) => {
    if (denied(req.me, reply)) return reply
    return { success: true, data: await health.listDuplicates(req.me, req.query.page, req.query.pageSize) }
  })

  server.get('/api/prospects/merge/preview', { ...auth, schema: { querystring: MergePreviewQuerySchema } }, async (req, reply) => {
    if (denied(req.me, reply)) return reply
    try {
      const data = await health.previewMerge(req.me, req.query.masterId, req.query.otherId)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return healthErrorReply(reply, err)
    }
  })

  server.post('/api/prospects/merge', { ...auth, schema: { body: MergeBodySchema } }, async (req, reply) => {
    try {
      const data = await health.mergeProspects(req.me, req.body.masterId, req.body.otherId, req.body.fields)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return healthErrorReply(reply, err)
    }
  })
}
