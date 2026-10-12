import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { CreateNoteSchema, ListNotesQuerySchema, UpdateNoteSchema } from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'

export async function notesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/notes',
    { preHandler: [app.authenticate], schema: { querystring: ListNotesQuerySchema } },
    async (req) => {
      const rows = await service.listNotes(req.me, req.query)
      return { success: true, data: rows }
    },
  )

  server.post(
    '/api/notes',
    { preHandler: [app.authenticate], schema: { body: CreateNoteSchema } },
    async (req, reply) => {
      const row = await service.createNote(req.me, req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.patch(
    '/api/notes/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateNoteSchema } },
    async (req, reply) => {
      const row = await service.updateNote(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.notes.notFound') })
      return { success: true, data: row }
    },
  )

  server.delete('/api/notes/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteNote(req.me, (req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: tr('errors.notes.notFound') })
    return { success: true }
  })
}
