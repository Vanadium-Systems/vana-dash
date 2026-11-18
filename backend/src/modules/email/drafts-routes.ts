import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { DraftSendSchema, DraftsQuerySchema, DraftUpdateSchema, DraftUpsertSchema, IdParamsSchema } from './drafts-schema.js'
import * as drafts from './drafts-service.js'
import { MailboxForbidden } from './mailboxes.js'
import { sendDraft } from './scheduled-send.js'
import { sendErrorReply } from './send-guard.js'
import { fail } from '../../shared/lib/http-error.js'
import { validationMessage } from '../../shared/lib/validation-messages.js'

function draftErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof drafts.DraftChangedError) {
    return fail(reply, 409, err.code, { details: { updatedAt: err.updatedAt } })
  }
  if (err instanceof MailboxForbidden) return fail(reply, 403, err.code)
  if (err instanceof drafts.DraftRefNotFound) return fail(reply, 404, 'DRAFT_REF_NOT_FOUND', { message: err.message })
  if (err instanceof drafts.DraftAttachmentRejected) return fail(reply, 400, 'DRAFT_ATTACHMENT_REJECTED', { message: err.message })
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
      if (!draft) return fail(reply, 404, 'DRAFT_NOT_FOUND')
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
        if (!draft) return fail(reply, 404, 'DRAFT_NOT_FOUND')
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
      if (!deleted) return fail(reply, 404, 'DRAFT_NOT_FOUND')
      return { success: true }
    },
  )

  server.post(
    '/api/email/drafts/:id/send',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const body = DraftSendSchema.safeParse(req.body ?? {})
      if (!body.success) return fail(reply, 400, 'VALIDATION_FAILED', { message: validationMessage(body.error.issues) })
      try {
        return reply.code(202).send({ success: true, data: await sendDraft(req.me, req.params.id, body.data) })
      } catch (err) {
        return sendErrorReply(reply, err)
      }
    },
  )
}
