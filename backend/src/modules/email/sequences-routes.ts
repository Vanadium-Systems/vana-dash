import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  EnrollSchema,
  EnrollmentUpdateSchema,
  SequenceCreateSchema,
  SequenceEnrollmentIdParamsSchema,
  SequenceIdParamsSchema,
  SequenceUpdateSchema,
} from './sequences-schema.js'
import { MailboxForbidden } from './mailboxes.js'
import * as service from './sequences-service.js'
import { fail, HttpError } from '../../shared/lib/http-error.js'

// Rute Secvențe outreach (drip automat) — contractul fixat în PLAN.md, montat separat de
// routes.ts (templates/send/bulk-send/sends), pattern identic inbound-routes.ts/drafts-routes.ts.
export async function emailSequencesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Secvența trimite singură, de pe identitatea aleasă la creare: fără `email.bulk` pe cutia
  // aia, răspunsul e tot un refuz de cutie (403), nu o eroare internă.
  const onMailboxError = (err: unknown, reply: FastifyReply) => {
    if (err instanceof MailboxForbidden) {
      return fail(reply, 403, err.code, { message: err.message, details: { feature: err.fromKey } })
    }
    return null
  }

  server.get('/api/email/sequences', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listSequences() }
  })

  server.post(
    '/api/email/sequences',
    { preHandler: [app.authenticate], schema: { body: SequenceCreateSchema } },
    async (req, reply) => {
      try {
        const row = await service.createSequence(req.me, req.body)
        return reply.code(201).send({ success: true, data: row })
      } catch (err) {
        const refuz = onMailboxError(err, reply)
        if (refuz) return refuz
        throw err
      }
    },
  )

  server.patch(
    '/api/email/sequences/:id',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema, body: SequenceUpdateSchema } },
    async (req, reply) => {
      try {
        const row = await service.updateSequence(req.me, req.params.id, req.body)
        if (!row) return fail(reply, 404, 'EMAIL_SEQUENCE_NOT_FOUND')
        return { success: true, data: row }
      } catch (err) {
        const refuz = onMailboxError(err, reply)
        if (refuz) return refuz
        throw err
      }
    },
  )

  server.delete(
    '/api/email/sequences/:id',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema } },
    async (req, reply) => {
      const deleted = await service.softDeleteSequence(req.params.id)
      if (!deleted) return fail(reply, 404, 'EMAIL_SEQUENCE_NOT_FOUND')
      return { success: true }
    },
  )

  server.get(
    '/api/email/sequences/:id/enrollments',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.listEnrollments(req.me, req.params.id) }
    },
  )

  server.get(
    '/api/email/sequences/:id/stats',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.getSequenceStats(req.params.id) }
    },
  )

  server.get(
    '/api/email/sequences/:id/diagnostics',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema } },
    async (req, reply) => {
      const data = await service.getSequenceDiagnostics(req.params.id)
      if (!data) return fail(reply, 404, 'EMAIL_SEQUENCE_NOT_FOUND')
      return { success: true, data }
    },
  )

  server.post(
    '/api/email/sequences/:id/enroll',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema, body: EnrollSchema } },
    async (req, reply) => {
      try {
        const result = await service.enrollRecipients(req.params.id, req.body.recipients, {
          me: req.me,
          listId: req.body.listId,
          prospectIds: req.body.prospectIds,
        })
        return { success: true, data: result }
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'sequence enroll failed')
        return fail(reply, 400, 'SEQUENCE_ENROLL_FAILED')
      }
    },
  )

  server.patch(
    '/api/email/sequences/:id/enrollments/:enrollmentId',
    { preHandler: [app.authenticate], schema: { params: SequenceEnrollmentIdParamsSchema, body: EnrollmentUpdateSchema } },
    async (req, reply) => {
      const row = await service.updateEnrollmentStatus(req.params.id, req.params.enrollmentId, req.body.status)
      if (!row) return fail(reply, 404, 'EMAIL_ENROLLMENT_NOT_FOUND')
      return { success: true, data: row }
    },
  )
}
