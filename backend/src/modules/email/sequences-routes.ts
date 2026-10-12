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
import { tr } from '../../shared/lib/i18n.js'

// Rute Secvențe outreach (drip automat) — contractul fixat în PLAN.md, montat separat de
// routes.ts (templates/send/bulk-send/sends), pattern identic inbound-routes.ts/drafts-routes.ts.
export async function emailSequencesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Secvența trimite singură, de pe identitatea aleasă la creare: fără `email.bulk` pe cutia
  // aia, răspunsul e tot un refuz de cutie (403), nu o eroare internă.
  const onMailboxError = (err: unknown, reply: FastifyReply) => {
    if (err instanceof MailboxForbidden) {
      return reply.code(403).send({ success: false, error: { code: err.code, feature: err.fromKey } })
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
        if (!row) return reply.code(404).send({ success: false, error: tr('errors.email.sequenceNotFound') })
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
      if (!deleted) return reply.code(404).send({ success: false, error: tr('errors.email.sequenceNotFound') })
      return { success: true }
    },
  )

  server.get(
    '/api/email/sequences/:id/enrollments',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.listEnrollments(req.params.id) }
    },
  )

  server.get(
    '/api/email/sequences/:id/stats',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.getSequenceStats(req.params.id) }
    },
  )

  server.post(
    '/api/email/sequences/:id/enroll',
    { preHandler: [app.authenticate], schema: { params: SequenceIdParamsSchema, body: EnrollSchema } },
    async (req, reply) => {
      try {
        const result = await service.enrollRecipients(req.params.id, req.body.recipients)
        return { success: true, data: result }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )

  server.patch(
    '/api/email/sequences/:id/enrollments/:enrollmentId',
    { preHandler: [app.authenticate], schema: { params: SequenceEnrollmentIdParamsSchema, body: EnrollmentUpdateSchema } },
    async (req, reply) => {
      const row = await service.updateEnrollmentStatus(req.params.id, req.params.enrollmentId, req.body.status)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.email.enrollmentNotFound') })
      return { success: true, data: row }
    },
  )
}
