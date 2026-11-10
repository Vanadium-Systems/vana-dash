import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import { prospectListsRoutes } from './lists-routes.js'
import { CreateViewSchema, UpdateViewSchema, ViewParamsSchema } from './views-schema.js'
import * as views from './views-service.js'

/** Saved views and their stars; also registers the lists routes, so app.ts needs one line. Static paths win over `/api/prospects/:id`. */
export async function prospectSavedRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }
  const notFound = (reply: FastifyReply) => reply.code(404).send({ success: false, error: tr('errors.prospects.viewNotFound') })

  // ── Views ──
  server.get('/api/prospects/views', auth, async (req) => ({ success: true, data: await views.listViews(req.me) }))

  server.post('/api/prospects/views', { ...auth, schema: { body: CreateViewSchema } }, async (req, reply) => {
    return reply.code(201).send({ success: true, data: await views.createView(req.me, req.body) })
  })

  server.patch('/api/prospects/views/:id', { ...auth, schema: { params: ViewParamsSchema, body: UpdateViewSchema } }, async (req, reply) => {
    const data = await views.updateView(req.me, req.params.id, req.body)
    return data ? { success: true, data } : notFound(reply)
  })

  server.delete('/api/prospects/views/:id', { ...auth, schema: { params: ViewParamsSchema } }, async (req, reply) => {
    return (await views.deleteView(req.me, req.params.id)) ? { success: true } : notFound(reply)
  })

  server.put('/api/prospects/views/:id/star', { ...auth, schema: { params: ViewParamsSchema } }, async (req, reply) => {
    return (await views.starView(req.me, req.params.id)) ? { success: true } : notFound(reply)
  })

  server.delete('/api/prospects/views/:id/star', { ...auth, schema: { params: ViewParamsSchema } }, async (req, reply) => {
    return (await views.unstarView(req.me, req.params.id)) ? { success: true } : notFound(reply)
  })

  await app.register(prospectListsRoutes)
}
