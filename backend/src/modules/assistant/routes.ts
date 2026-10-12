import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import * as service from './service.js'
import type { AssistantSseEvent } from './service.js'
import * as quota from './quota.js'
import * as scheduledService from './tools/scheduled.js'
import * as providers from './providers/index.js'
import { ProviderIdParamsSchema, ProviderUpdateSchema } from './providers-schema.js'
import { tr } from '../../shared/lib/i18n.js'

// Modelele nu mai sunt un enum hardcodat — vin din assistant_providers (editabile din UI),
// cu fallback pe ASSISTANT_MODELS. Validarea rămâne la service (contra listei disponibile).
const ModelSchema = z.string().trim().min(1)
const ProviderOverrideSchema = z.enum(['anthropic', 'openrouter'])

const SendMessageSchema = z.object({ text: z.string().min(1) })
// .nullish(), nu .optional(): Fastify 5 livrează req.body = null pe POST-ul fără corp trimis
// de FE la crearea conversației — z.object().optional() respinge null ("Expected object, received null")
const CreateConversationSchema = z
  .object({ model: ModelSchema.optional(), provider: ProviderOverrideSchema.optional() })
  .nullish()
const UpdateConversationSchema = z.object({ model: ModelSchema, provider: ProviderOverrideSchema.optional() })
const ActionIdParamsSchema = z.object({ id: z.string().uuid() })
const ConversationIdParamsSchema = z.object({ id: z.string().uuid() })

function writeSseEvent(reply: FastifyReply, event: AssistantSseEvent) {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
}

async function streamGenerator(reply: FastifyReply, generator: AsyncGenerator<AssistantSseEvent>) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  try {
    for await (const event of generator) {
      writeSseEvent(reply, event)
    }
  } catch (err) {
    writeSseEvent(reply, { type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    reply.raw.end()
  }
}

export async function assistantRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/assistant/models', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await providers.listAvailableModels() }
  })

  // ── Setări provideri (sprint multi-provider) — cheile NICIODATĂ în răspuns, doar masked ────

  server.get('/api/assistant/providers', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await providers.listProviderSettings() }
  })

  server.put(
    '/api/assistant/providers/:provider',
    { preHandler: [app.authenticate], schema: { params: ProviderIdParamsSchema, body: ProviderUpdateSchema } },
    async (req) => {
      await providers.updateProvider(req.params.provider, req.body)
      return { success: true, data: await providers.listProviderSettings() }
    },
  )

  server.post(
    '/api/assistant/conversations',
    { preHandler: [app.authenticate], schema: { body: CreateConversationSchema } },
    async (req) => {
      const row = await service.createConversation(req.me, req.body?.model as service.AssistantModelId | undefined, req.body?.provider)
      return { success: true, data: row }
    },
  )

  server.get('/api/assistant/conversations', { preHandler: [app.authenticate] }, async (req) => {
    const rows = await service.listConversations(req.me)
    return { success: true, data: rows }
  })

  server.patch(
    '/api/assistant/conversations/:id',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: UpdateConversationSchema } },
    async (req, reply) => {
      const row = await service.updateConversationModel(req.me, req.params.id, req.body.model as service.AssistantModelId, req.body.provider)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.chat.conversationNotFound') })
      return { success: true, data: row }
    },
  )

  server.delete(
    '/api/assistant/conversations/:id',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema } },
    async (req, reply) => {
      const row = await service.deleteConversation(req.me, req.params.id)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.chat.conversationNotFound') })
      return { success: true, data: row }
    },
  )

  server.get(
    '/api/assistant/conversations/:id/messages',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema } },
    async (req) => {
      const rows = await service.listConversationMessages(req.params.id)
      return { success: true, data: rows }
    },
  )

  server.post(
    '/api/assistant/conversations/:id/messages',
    { preHandler: [app.authenticate], schema: { params: ConversationIdParamsSchema, body: SendMessageSchema } },
    async (req, reply) => {
      const check = await quota.checkQuota(req.me)
      if (!check.ok) return reply.code(429).send({ success: false, error: { code: check.code, message: check.message } })
      reply.hijack()
      await streamGenerator(reply, service.runConversationTurn(req.params.id, req.body.text))
    },
  )

  server.post(
    '/api/assistant/actions/:id/confirm',
    { preHandler: [app.authenticate], schema: { params: ActionIdParamsSchema } },
    async (req, reply) => {
      const result = await service.confirmPendingAction(req.params.id)
      if (!result.ok) return reply.code(400).send({ success: false, error: result.error })

      // Confirmarea continuă conversația cu un tur nou de model — deci tot la plafon, tot 429,
      // cu același mesaj (C2).
      const check = await quota.checkQuota(req.me)
      if (!check.ok) return reply.code(429).send({ success: false, error: { code: check.code, message: check.message } })

      reply.hijack()
      await streamGenerator(reply, await service.continueAfterAction(result.conversationId))
    },
  )

  server.post(
    '/api/assistant/actions/:id/reject',
    { preHandler: [app.authenticate], schema: { params: ActionIdParamsSchema } },
    async (req, reply) => {
      const result = await service.rejectPendingAction(req.params.id)
      if (!result.ok) return reply.code(400).send({ success: false, error: result.error })

      reply.hijack()
      await streamGenerator(reply, await service.continueAfterAction(result.conversationId))
    },
  )

  // Task-uri programate din chat (Contract B) — chips cu anulare sub conversație.
  server.get('/api/assistant/scheduled', { preHandler: [app.authenticate] }, async (req) => {
    const rows = await scheduledService.listScheduledRuns(req.me)
    return { success: true, data: rows }
  })

  server.delete(
    '/api/assistant/scheduled/:id',
    { preHandler: [app.authenticate], schema: { params: ActionIdParamsSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await scheduledService.cancelScheduledRun(req.me, req.params.id) }
      } catch (err) {
        return reply.code(400).send({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  )
}
