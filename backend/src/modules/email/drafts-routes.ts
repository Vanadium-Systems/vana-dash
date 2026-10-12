import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { DraftUpdateSchema, DraftUpsertSchema, IdParamsSchema } from './drafts-schema.js'
import * as drafts from './drafts-service.js'

export async function emailDraftsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/email/drafts', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await drafts.listDrafts(req.me) }
  })

  server.get(
    '/api/email/drafts/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const draft = await drafts.getDraft(req.me, req.params.id)
      if (!draft) return reply.code(404).send({ success: false, error: 'Draft not found' })
      return { success: true, data: draft }
    },
  )

  server.post(
    '/api/email/drafts',
    { preHandler: [app.authenticate], schema: { body: DraftUpsertSchema } },
    async (req, reply) => reply.code(201).send({ success: true, data: await drafts.createDraft(req.me, req.body) }),
  )

  server.patch(
    '/api/email/drafts/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: DraftUpdateSchema } },
    async (req, reply) => {
      const draft = await drafts.updateDraft(req.me, req.params.id, req.body)
      if (!draft) return reply.code(404).send({ success: false, error: 'Draft not found' })
      return { success: true, data: draft }
    },
  )

  server.delete(
    '/api/email/drafts/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const deleted = await drafts.deleteDraft(req.me, req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Draft not found' })
      return { success: true }
    },
  )

  server.post(
    '/api/email/drafts/:id/send',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await drafts.sendDraft(req.me, req.params.id) }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )
}
