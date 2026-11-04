import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { MySettingsUpdateSchema } from './me-schema.js'
import * as me from './me-service.js'
import { IdParamsSchema, LabelCreateSchema, LabelUpdateSchema, RuleCreateSchema, RuleUpdateSchema } from './organize-schema.js'
import * as organize from './organize-service.js'
import { organizeErrorReply } from './organize-routes.js'
import { getSuppressionsOverview } from './unsubscribe-service.js'

// A person's own email settings (email.setari_proprii), so a colleague does not need the
// company's Settings (email.setari) for a signature, a lower outreach cap or their own labels.
// Unsubscribes and the blocklist are the company's and are read-only here.
export async function emailMeRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/email/me/settings', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await me.getMySettings(req.me) }
  })

  server.patch(
    '/api/email/me/settings',
    { preHandler: [app.authenticate], schema: { body: MySettingsUpdateSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await me.updateMySettings(req.me, req.body) }
      } catch (err) {
        if (err instanceof me.CapAboveCompany) {
          return reply.code(400).send({ success: false, error: { code: err.code, limit: err.limit } })
        }
        if (err instanceof me.MailboxNotMine) {
          return reply.code(400).send({ success: false, error: { code: err.code, identityKey: err.identityKey } })
        }
        throw err
      }
    },
  )

  // ── My labels ──────────────────────────────────────────────────────────────

  server.get('/api/email/me/labels', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await organize.listOwnLabels(req.me.id) }
  })

  server.post(
    '/api/email/me/labels',
    { preHandler: [app.authenticate], schema: { body: LabelCreateSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await organize.createLabel(req.body, req.me.id) })
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.patch(
    '/api/email/me/labels/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: LabelUpdateSchema } },
    async (req, reply) => {
      try {
        const label = await organize.updateLabel(req.params.id, req.body, req.me.id)
        if (!label) return reply.code(404).send({ success: false, error: 'Label not found' })
        return { success: true, data: label }
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.delete(
    '/api/email/me/labels/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      if (!(await organize.deleteLabel(req.params.id, req.me.id))) {
        return reply.code(404).send({ success: false, error: 'Label not found' })
      }
      return { success: true }
    },
  )

  // ── My rules ───────────────────────────────────────────────────────────────

  server.get('/api/email/me/rules', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await organize.listRules(req.me.id) }
  })

  server.post(
    '/api/email/me/rules',
    { preHandler: [app.authenticate], schema: { body: RuleCreateSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await organize.createRule(req.body, req.me.id) })
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.patch(
    '/api/email/me/rules/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: RuleUpdateSchema } },
    async (req, reply) => {
      try {
        const rule = await organize.updateRule(req.params.id, req.body, req.me.id)
        if (!rule) return reply.code(404).send({ success: false, error: 'Rule not found' })
        return { success: true, data: rule }
      } catch (err) {
        return organizeErrorReply(reply, err)
      }
    },
  )

  server.delete(
    '/api/email/me/rules/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      if (!(await organize.deleteRule(req.params.id, req.me.id))) {
        return reply.code(404).send({ success: false, error: 'Rule not found' })
      }
      return { success: true }
    },
  )

  // ── Read-only: the company's lists ─────────────────────────────────────────

  server.get('/api/email/me/suppressions', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await getSuppressionsOverview() }
  })

  server.get('/api/email/me/blocklist', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await organize.listBlocklist() }
  })
}
