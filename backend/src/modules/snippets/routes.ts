import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import { CreateSnippetSchema, SnippetParamsSchema, UpdateSnippetSchema } from './schema.js'
import * as service from './service.js'

export async function snippetsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/snippets', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await service.listSnippets(req.me) }
  })

  server.post('/api/snippets', { preHandler: [app.authenticate], schema: { body: CreateSnippetSchema } }, async (req, reply) => {
    return reply.code(201).send({ success: true, data: await service.createSnippet(req.me, req.body) })
  })

  server.patch(
    '/api/snippets/:id',
    { preHandler: [app.authenticate], schema: { params: SnippetParamsSchema, body: UpdateSnippetSchema } },
    async (req, reply) => {
      const row = await service.updateSnippet(req.me, req.params.id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.snippets.notFound') })
      return { success: true, data: row }
    },
  )

  server.delete('/api/snippets/:id', { preHandler: [app.authenticate], schema: { params: SnippetParamsSchema } }, async (req, reply) => {
    const row = await service.deleteSnippet(req.me, req.params.id)
    if (!row) return reply.code(404).send({ success: false, error: tr('errors.snippets.notFound') })
    return { success: true }
  })
}
