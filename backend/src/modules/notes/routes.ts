import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { BulkNotesSchema, CreateNoteSchema, ListNotesQuerySchema, RenameLabelSchema, UpdateNoteSchema } from './schema.js'
import * as service from './service.js'
import { NoteChangedError, NoteInputError, NoteNotFoundError } from './service.js'
import * as versions from './versions.js'

type IdParams = { id: string }

export async function notesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof NoteNotFoundError) return reply.code(404).send({ success: false, error: error.message })
    if (error instanceof NoteInputError) return reply.code(400).send({ success: false, error: error.message, code: error.code })
    if (error instanceof NoteChangedError) {
      return reply.code(409).send({ success: false, error: error.message, code: 'NOTE_CHANGED', data: error.current })
    }
    throw error
  })

  server.get(
    '/api/notes',
    { preHandler: [app.authenticate], schema: { querystring: ListNotesQuerySchema } },
    async (req) => ({ success: true, data: await service.listNotes(req.me, req.query) }),
  )

  server.get('/api/notes/labels', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.listLabels(req.me),
  }))

  server.patch(
    '/api/notes/labels/:name',
    { preHandler: [app.authenticate], schema: { body: RenameLabelSchema } },
    async (req) => ({
      success: true,
      data: await service.changeLabel(req.me, (req.params as { name: string }).name, req.body.newName),
    }),
  )

  server.delete('/api/notes/labels/:name', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.changeLabel(req.me, (req.params as { name: string }).name, null),
  }))

  server.post(
    '/api/notes/bulk',
    { preHandler: [app.authenticate], schema: { body: BulkNotesSchema } },
    async (req) => ({
      success: true,
      data: await service.bulkUpdate(req.me, req.body.ids, req.body.action, req.body.value),
    }),
  )

  server.delete('/api/notes/trash', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.emptyTrash(req.me),
  }))

  server.get('/api/notes/:id', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.getNote(req.me, (req.params as IdParams).id),
  }))

  server.post(
    '/api/notes',
    { preHandler: [app.authenticate], schema: { body: CreateNoteSchema } },
    async (req, reply) => reply.code(201).send({ success: true, data: await service.createNote(req.me, req.body) }),
  )

  server.patch(
    '/api/notes/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateNoteSchema } },
    async (req) => ({ success: true, data: await service.updateNote(req.me, (req.params as IdParams).id, req.body) }),
  )

  server.patch('/api/notes/:id/archive', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.setArchived(req.me, (req.params as IdParams).id, true),
  }))

  server.patch('/api/notes/:id/unarchive', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.setArchived(req.me, (req.params as IdParams).id, false),
  }))

  server.delete('/api/notes/:id', { preHandler: [app.authenticate] }, async (req) => {
    const row = await service.deleteNote(req.me, (req.params as IdParams).id)
    if (!row) throw new NoteNotFoundError()
    return { success: true }
  })

  server.post('/api/notes/:id/restore', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.restoreNote(req.me, (req.params as IdParams).id),
  }))

  server.get('/api/notes/:id/versions', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await versions.listVersions(req.me, (req.params as IdParams).id),
  }))

  server.get('/api/notes/:id/versions/:vid', { preHandler: [app.authenticate] }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: string }
    return { success: true, data: await versions.getVersion(req.me, id, vid) }
  })

  server.post('/api/notes/:id/versions/:vid/restore', { preHandler: [app.authenticate] }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: string }
    return { success: true, data: await versions.restoreVersion(req.me, id, vid) }
  })
}
