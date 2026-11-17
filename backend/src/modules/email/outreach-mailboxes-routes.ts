import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { fail } from '../../shared/lib/http-error.js'
import {
  OutreachMailboxCreateSchema,
  OutreachMailboxIdParamsSchema,
  OutreachMailboxUpdateSchema,
} from './outreach-mailboxes-schema.js'
import * as service from './outreach-mailboxes-service.js'

export async function emailOutreachMailboxesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Safe summary for Bulk Send and Sequences (accessible under `email.bulk` without admin settings).
  server.get('/api/email/outreach-summary', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listOutreachMailboxSummaries() }
  })

  server.get('/api/email/outreach-mailboxes', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listOutreachMailboxes() }
  })

  server.post(
    '/api/email/outreach-mailboxes',
    { preHandler: [app.authenticate], schema: { body: OutreachMailboxCreateSchema } },
    async (req, reply) => {
      try {
        const created = await service.createOutreachMailbox(req.body)
        return reply.code(201).send({ success: true, data: created })
      } catch (err) {
        const pgErr = err as { code?: string }
        if (pgErr.code === '23505') {
          return fail(reply, 409, 'OUTREACH_MAILBOX_EXISTS')
        }
        throw err
      }
    },
  )

  server.patch(
    '/api/email/outreach-mailboxes/:id',
    {
      preHandler: [app.authenticate],
      schema: { params: OutreachMailboxIdParamsSchema, body: OutreachMailboxUpdateSchema },
    },
    async (req, reply) => {
      const updated = await service.updateOutreachMailbox(req.params.id, req.body)
      if (!updated) return fail(reply, 404, 'OUTREACH_MAILBOX_NOT_FOUND')
      return { success: true, data: updated }
    },
  )

  server.delete(
    '/api/email/outreach-mailboxes/:id',
    { preHandler: [app.authenticate], schema: { params: OutreachMailboxIdParamsSchema } },
    async (req, reply) => {
      const deleted = await service.softDeleteOutreachMailbox(req.params.id)
      if (!deleted) return fail(reply, 404, 'OUTREACH_MAILBOX_NOT_FOUND')
      return { success: true }
    },
  )

  server.post(
    '/api/email/outreach-mailboxes/:id/test',
    { preHandler: [app.authenticate], schema: { params: OutreachMailboxIdParamsSchema } },
    async (req, reply) => {
      const result = await service.testOutreachMailbox(req.params.id, req.me.email)
      if (!result.ok) {
        if (result.code === 'NOT_FOUND') {
          return fail(reply, 404, 'OUTREACH_MAILBOX_NOT_FOUND')
        }
        const status = result.code === 'OUTREACH_REAL_SENDING_DISABLED' ? 403 : 422
        return fail(reply, status, result.code)
      }
      return { success: true, data: { sentTo: req.me.email } }
    },
  )
}
