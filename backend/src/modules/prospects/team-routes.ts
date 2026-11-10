import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import { canReassign } from '../../shared/lib/prospect-access.js'
import { prospectErrorReply } from './routes.js'
import {
  CollaboratorBodySchema,
  CollaboratorParamsSchema,
  CreateTransferRequestSchema,
  DecideTransferRequestSchema,
  ProspectParamsSchema,
  ReleaseSettingsSchema,
  TransferProspectsSchema,
  TransferRequestParamsSchema,
  TransferRequestsQuerySchema,
} from './team-schema.js'
import * as team from './team-service.js'

function teamErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof team.ProspectTakenError) {
    return reply.code(409).send({ success: false, error: tr('errors.prospects.taken', { owner: err.ownerName ?? '' }), code: err.code, ownerName: err.ownerName })
  }
  if (err instanceof team.RequestExistsError) return reply.code(409).send({ success: false, error: tr('errors.prospects.requestExists'), code: err.code })
  if (err instanceof team.RequestDecidedError) return reply.code(409).send({ success: false, error: tr('errors.prospects.requestDecided'), code: err.code })
  if (err instanceof team.RequestNotAllowedError) return reply.code(403).send({ success: false, error: tr('errors.prospects.requestNotAllowed'), code: err.code })
  if (err instanceof team.RequestInvalidError) return reply.code(400).send({ success: false, error: tr('errors.prospects.requestInvalid'), code: err.code })
  if (err instanceof team.InvalidRecipientError) {
    return reply.code(400).send({ success: false, error: tr(err.what === 'recipient' ? 'errors.prospects.recipientInvalid' : 'errors.prospects.collaboratorInvalid'), code: err.code })
  }
  return prospectErrorReply(reply, err)
}

export async function prospectTeamRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }
  const notFound = (reply: FastifyReply, key: 'errors.prospects.notFound' | 'errors.prospects.requestNotFound' = 'errors.prospects.notFound') =>
    reply.code(404).send({ success: false, error: tr(key) })

  server.post('/api/prospects/:id/claim', { ...auth, schema: { params: ProspectParamsSchema } }, async (req, reply) => {
    try {
      const data = await team.claimProspect(req.me, req.params.id)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return teamErrorReply(reply, err)
    }
  })

  server.post('/api/prospects/:id/release', { ...auth, schema: { params: ProspectParamsSchema } }, async (req, reply) => {
    try {
      const data = await team.releaseProspect(req.me, req.params.id)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return teamErrorReply(reply, err)
    }
  })

  // Static paths first-class in Fastify: `transfer`, `transfer-requests` and `release-settings` win over `:id`.
  server.post('/api/prospects/transfer', { ...auth, schema: { body: TransferProspectsSchema } }, async (req, reply) => {
    try {
      return { success: true, data: await team.transferProspects(req.me, req.body) }
    } catch (err) {
      return teamErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/transfer-requests', { ...auth, schema: { querystring: TransferRequestsQuerySchema } }, async (req) => {
    return { success: true, data: await team.listTransferRequests(req.me, req.query.scope) }
  })

  server.post('/api/prospects/:id/transfer-requests', { ...auth, schema: { params: ProspectParamsSchema, body: CreateTransferRequestSchema } }, async (req, reply) => {
    try {
      const data = await team.createTransferRequest(req.me, req.params.id, req.body)
      return data ? reply.code(201).send({ success: true, data }) : notFound(reply)
    } catch (err) {
      return teamErrorReply(reply, err)
    }
  })

  server.patch('/api/prospects/transfer-requests/:rid', { ...auth, schema: { params: TransferRequestParamsSchema, body: DecideTransferRequestSchema } }, async (req, reply) => {
    try {
      const data = await team.decideTransferRequest(req.me, req.params.rid, req.body.action)
      return data ? { success: true, data } : notFound(reply, 'errors.prospects.requestNotFound')
    } catch (err) {
      return teamErrorReply(reply, err)
    }
  })

  server.put('/api/prospects/:id/collaborators/:userId', { ...auth, schema: { params: CollaboratorParamsSchema, body: CollaboratorBodySchema } }, async (req, reply) => {
    try {
      const data = await team.setCollaborator(req.me, req.params.id, req.params.userId, req.body)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return teamErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/:id/collaborators/:userId', { ...auth, schema: { params: CollaboratorParamsSchema } }, async (req, reply) => {
    try {
      const data = await team.removeCollaborator(req.me, req.params.id, req.params.userId)
      return data ? { success: true } : notFound(reply)
    } catch (err) {
      return teamErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/:id/contact-check', { ...auth, schema: { params: ProspectParamsSchema } }, async (req, reply) => {
    const data = await team.contactCheck(req.me, req.params.id)
    return data ? { success: true, data } : notFound(reply)
  })

  server.get('/api/prospects/release-settings', auth, async () => {
    return { success: true, data: await team.getReleaseSettings() }
  })

  // The catalog gives writes under /api/prospects to `clienti.prospectare`; changing when prospects
  // fall back to the pool is a manager's call.
  server.put('/api/prospects/release-settings', { ...auth, schema: { body: ReleaseSettingsSchema } }, async (req, reply) => {
    if (!canReassign(req.me)) return reply.code(403).send({ success: false, error: tr('errors.prospects.reassignOnly') })
    return { success: true, data: await team.setReleaseSettings(req.body) }
  })
}
