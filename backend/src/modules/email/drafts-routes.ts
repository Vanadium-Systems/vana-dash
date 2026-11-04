import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { DraftSendSchema, DraftsQuerySchema, DraftUpdateSchema, DraftUpsertSchema, IdParamsSchema } from './drafts-schema.js'
import * as drafts from './drafts-service.js'
import { sendDraft } from './scheduled-send.js'
import { sendErrorReply } from './send-guard.js'

function draftErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof drafts.DraftChangedError) {
    return reply.code(409).send({ success: false, error: { code: err.code, updatedAt: err.updatedAt } })
  }
  if (err instanceof drafts.DraftRefNotFound) return reply.code(404).send({ success: false, error: err.message })
  if (err instanceof drafts.DraftAttachmentRejected) return reply.code(400).send({ success: false, error: err.message })
  throw err
}

export async function emailDraftsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/email/drafts',
    { preHandler: [app.authenticate], schema: { querystring: DraftsQuerySchema } },
    async (req) => ({ success: true, data: await drafts.listDrafts(req.me, req.query.threadId) }),
  )

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
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await drafts.createDraft(req.me, req.body) })
      } catch (err) {
        return draftErrorReply(reply, err)
      }
    },
  )

  server.patch(
    '/api/email/drafts/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: DraftUpdateSchema } },
    async (req, reply) => {
      try {
        const draft = await drafts.updateDraft(req.me, req.params.id, req.body)
        if (!draft) return reply.code(404).send({ success: false, error: 'Draft not found' })
        return { success: true, data: draft }
      } catch (err) {
        return draftErrorReply(reply, err)
      }
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
      const body = DraftSendSchema.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ success: false, error: body.error.issues[0]?.message ?? 'Invalid body' })
      try {
        return reply.code(202).send({ success: true, data: await sendDraft(req.me, req.params.id, body.data) })
      } catch (err) {
        return sendErrorReply(reply, err)
      }
    },
  )
}
