import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { BulkNotesSchema, CreateNoteSchema, ListNotesQuerySchema, RenameLabelSchema, UpdateNoteSchema } from './schema.js'
import * as service from './service.js'
import { NoteChangedError, NoteInputError, NoteNotFoundError } from './service.js'
import * as versions from './versions.js'
import { fail } from '../../shared/lib/http-error.js'

const IdParamsSchema = z.object({ id: z.string().uuid() })
const VersionParamsSchema = z.object({ id: z.string().uuid(), vid: z.string().uuid() })
const LabelParamsSchema = z.object({ name: z.string().min(1) })

export async function notesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof NoteNotFoundError) return fail(reply, 404, 'NOTE_NOT_FOUND', { message: error.message })
    if (error instanceof NoteInputError) return fail(reply, 400, error.code, { message: error.message })
    if (error instanceof NoteChangedError) {
      return fail(reply, 409, 'NOTE_CHANGED', { message: error.message, details: { current: error.current } })
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
    { preHandler: [app.authenticate], schema: { params: LabelParamsSchema, body: RenameLabelSchema } },
    async (req) => ({
      success: true,
      data: await service.changeLabel(req.me, req.params.name, req.body.newName),
    }),
  )

  server.delete(
    '/api/notes/labels/:name',
    { preHandler: [app.authenticate], schema: { params: LabelParamsSchema } },
    async (req) => ({
      success: true,
      data: await service.changeLabel(req.me, req.params.name, null),
    }),
  )

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

  server.get(
    '/api/notes/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => ({
      success: true,
      data: await service.getNote(req.me, req.params.id),
    }),
  )

  server.post(
    '/api/notes',
    { preHandler: [app.authenticate], schema: { body: CreateNoteSchema } },
    async (req, reply) => reply.code(201).send({ success: true, data: await service.createNote(req.me, req.body) }),
  )

  server.patch(
    '/api/notes/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: UpdateNoteSchema } },
    async (req) => ({ success: true, data: await service.updateNote(req.me, req.params.id, req.body) }),
  )

  server.patch(
    '/api/notes/:id/archive',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => ({
      success: true,
      data: await service.setArchived(req.me, req.params.id, true),
    }),
  )

  server.patch(
    '/api/notes/:id/unarchive',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => ({
      success: true,
      data: await service.setArchived(req.me, req.params.id, false),
    }),
  )

  server.delete(
    '/api/notes/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => {
      const row = await service.deleteNote(req.me, req.params.id)
      if (!row) throw new NoteNotFoundError()
      return { success: true }
    },
  )

  server.post(
    '/api/notes/:id/restore',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => ({
      success: true,
      data: await service.restoreNote(req.me, req.params.id),
    }),
  )

  server.get(
    '/api/notes/:id/versions',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => ({
      success: true,
      data: await versions.listVersions(req.me, req.params.id),
    }),
  )

  server.get(
    '/api/notes/:id/versions/:vid',
    { preHandler: [app.authenticate], schema: { params: VersionParamsSchema } },
    async (req) => ({
      success: true,
      data: await versions.getVersion(req.me, req.params.id, req.params.vid),
    }),
  )

  server.post(
    '/api/notes/:id/versions/:vid/restore',
    { preHandler: [app.authenticate], schema: { params: VersionParamsSchema } },
    async (req) => ({
      success: true,
      data: await versions.restoreVersion(req.me, req.params.id, req.params.vid),
    }),
  )
}
