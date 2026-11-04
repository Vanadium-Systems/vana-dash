import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  BlocklistCreateSchema,
  IdParamsSchema,
  LabelCreateSchema,
  LabelUpdateSchema,
  RuleCreateSchema,
  RuleUpdateSchema,
} from './organize-schema.js'
import * as organize from './organize-service.js'

/** Shared with me-routes.ts: the same refusals for the company's labels/rules and a person's own. */
export function organizeErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof organize.LabelNameTaken || err instanceof organize.RuleLabelNotAllowed) {
    return reply.code(err instanceof organize.LabelNameTaken ? 409 : 400).send({ success: false, error: { code: err.code } })
  }
  return reply.code(400).send({ success: false, error: String(err) })
}

export async function emailOrganizeRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Labels ─────────────────────────────────────────────────────────────────

  // Read with email.view: the company's labels and the person's own.
  server.get('/api/email/labels', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await organize.listLabels(req.me) }
  })

  server.post(
    '/api/email/labels',
    { preHandler: [app.authenticate], schema: { body: LabelCreateSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await organize.createLabel(req.body) })
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.patch(
    '/api/email/labels/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: LabelUpdateSchema } },
    async (req, reply) => {
      try {
        const label = await organize.updateLabel(req.params.id, req.body)
        if (!label) return reply.code(404).send({ success: false, error: 'Label not found' })
        return { success: true, data: label }
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.delete(
    '/api/email/labels/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const deleted = await organize.deleteLabel(req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Label not found' })
      return { success: true }
    },
  )

  // ── Rules ──────────────────────────────────────────────────────────────────

  server.get('/api/email/rules', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await organize.listRules() }
  })

  server.post(
    '/api/email/rules',
    { preHandler: [app.authenticate], schema: { body: RuleCreateSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await organize.createRule(req.body) })
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.patch(
    '/api/email/rules/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: RuleUpdateSchema } },
    async (req, reply) => {
      try {
        const rule = await organize.updateRule(req.params.id, req.body)
        if (!rule) return reply.code(404).send({ success: false, error: 'Rule not found' })
        return { success: true, data: rule }
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.delete(
    '/api/email/rules/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const deleted = await organize.deleteRule(req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Rule not found' })
      return { success: true }
    },
  )

  server.post(
    '/api/email/rules/:id/apply-existing',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const affected = await organize.applyRuleToExisting(req.params.id)
        return { success: true, data: { affected } }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── Blocklist ──────────────────────────────────────────────────────────────

  server.get('/api/email/blocklist', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await organize.listBlocklist() }
  })

  server.post(
    '/api/email/blocklist',
    { preHandler: [app.authenticate], schema: { body: BlocklistCreateSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await organize.addToBlocklist(req.body) })
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.delete(
    '/api/email/blocklist/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const deleted = await organize.removeFromBlocklist(req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Blocklist entry not found' })
      return { success: true }
    },
  )

  server.post(
    '/api/email/blocklist/:id/apply-existing',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const affected = await organize.applyBlocklistToExisting(req.params.id)
        return { success: true, data: { affected } }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )
}
