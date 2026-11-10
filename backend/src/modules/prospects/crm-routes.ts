import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import * as crm from './crm-service.js'
import { prospectErrorReply } from './routes.js'
import {
  CompleteTaskSchema,
  ContactPointParamsSchema,
  CreateContactPointSchema,
  CreateNoteSchema,
  CreatePersonSchema,
  CreateProspectTaskSchema,
  NoteParamsSchema,
  PersonParamsSchema,
  ProspectParamsSchema,
  ProspectTaskParamsSchema,
  TaskCountsQuerySchema,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  UpdateContactPointSchema,
  UpdateNoteSchema,
  UpdatePersonSchema,
  UpdateProspectTaskSchema,
} from './schema.js'
import { InvalidAssigneeError } from './service.js'

function crmErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof crm.ContactExistsError) return reply.code(409).send({ success: false, error: tr('errors.prospects.contactExists'), code: err.code })
  if (err instanceof crm.NoteNotYoursError) return reply.code(403).send({ success: false, error: tr('errors.prospects.noteNotYours'), code: err.code })
  if (err instanceof InvalidAssigneeError) return reply.code(400).send({ success: false, error: tr('errors.prospects.assigneeInvalid') })
  if (err instanceof crm.ForeignRefError) {
    const error = tr(err.what === 'person' ? 'errors.prospects.personInvalid' : 'errors.prospects.contactPointInvalid')
    return reply.code(400).send({ success: false, error })
  }
  return prospectErrorReply(reply, err)
}

export async function prospectCrmRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }

  const notFound = (reply: FastifyReply, key: 'errors.prospects.notFound' | 'errors.prospects.taskNotFound' = 'errors.prospects.notFound') =>
    reply.code(404).send({ success: false, error: tr(key) })

  // ── People ──
  server.get('/api/prospects/:id/people', { ...auth, schema: { params: ProspectParamsSchema } }, async (req, reply) => {
    const data = await crm.listPeople(req.me, req.params.id)
    return data ? { success: true, data } : notFound(reply)
  })

  server.post('/api/prospects/:id/people', { ...auth, schema: { params: ProspectParamsSchema, body: CreatePersonSchema } }, async (req, reply) => {
    try {
      const data = await crm.createPerson(req.me, req.params.id, req.body)
      return data ? reply.code(201).send({ success: true, data }) : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.patch('/api/prospects/:id/people/:personId', { ...auth, schema: { params: PersonParamsSchema, body: UpdatePersonSchema } }, async (req, reply) => {
    try {
      const data = await crm.updatePerson(req.me, req.params.id, req.params.personId, req.body)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/:id/people/:personId', { ...auth, schema: { params: PersonParamsSchema } }, async (req, reply) => {
    try {
      const data = await crm.deletePerson(req.me, req.params.id, req.params.personId)
      return data ? { success: true } : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  // ── Contact points ──
  server.post('/api/prospects/:id/contact-points', { ...auth, schema: { params: ProspectParamsSchema, body: CreateContactPointSchema } }, async (req, reply) => {
    try {
      const data = await crm.createContactPoint(req.me, req.params.id, req.body)
      return data ? reply.code(201).send({ success: true, data }) : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.patch('/api/prospects/:id/contact-points/:cpId', { ...auth, schema: { params: ContactPointParamsSchema, body: UpdateContactPointSchema } }, async (req, reply) => {
    try {
      const data = await crm.updateContactPoint(req.me, req.params.id, req.params.cpId, req.body)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/:id/contact-points/:cpId', { ...auth, schema: { params: ContactPointParamsSchema } }, async (req, reply) => {
    try {
      const data = await crm.deleteContactPoint(req.me, req.params.id, req.params.cpId)
      return data ? { success: true } : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  // ── Notes ──
  server.get('/api/prospects/:id/notes', { ...auth, schema: { params: ProspectParamsSchema } }, async (req, reply) => {
    const data = await crm.listNotes(req.me, req.params.id)
    return data ? { success: true, data } : notFound(reply)
  })

  server.post('/api/prospects/:id/notes', { ...auth, schema: { params: ProspectParamsSchema, body: CreateNoteSchema } }, async (req, reply) => {
    const data = await crm.createNote(req.me, req.params.id, req.body)
    return data ? reply.code(201).send({ success: true, data }) : notFound(reply)
  })

  server.patch('/api/prospects/:id/notes/:noteId', { ...auth, schema: { params: NoteParamsSchema, body: UpdateNoteSchema } }, async (req, reply) => {
    try {
      const data = await crm.updateNote(req.me, req.params.id, req.params.noteId, req.body)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/:id/notes/:noteId', { ...auth, schema: { params: NoteParamsSchema } }, async (req, reply) => {
    try {
      const data = await crm.deleteNote(req.me, req.params.id, req.params.noteId)
      return data ? { success: true } : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  // ── Tasks: the cross-prospect page and "done" are static paths, which Fastify matches before `:id` ──
  server.get('/api/prospects/tasks', { ...auth, schema: { querystring: TaskListQuerySchema } }, async (req) => {
    return { success: true, data: await crm.listTasks(req.me, req.query) }
  })

  server.get('/api/prospects/tasks/counts', { ...auth, schema: { querystring: TaskCountsQuerySchema } }, async (req) => {
    return { success: true, data: await crm.taskCounts(req.me, req.query.scope) }
  })

  server.post('/api/prospects/tasks/:taskId/done', { ...auth, schema: { params: TaskIdParamsSchema, body: CompleteTaskSchema } }, async (req, reply) => {
    try {
      const data = await crm.completeTask(req.me, req.params.taskId, req.body)
      return data ? { success: true, data } : notFound(reply, 'errors.prospects.taskNotFound')
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/:id/tasks', { ...auth, schema: { params: ProspectParamsSchema } }, async (req, reply) => {
    const data = await crm.listProspectTasks(req.me, req.params.id)
    return data ? { success: true, data } : notFound(reply)
  })

  server.post('/api/prospects/:id/tasks', { ...auth, schema: { params: ProspectParamsSchema, body: CreateProspectTaskSchema } }, async (req, reply) => {
    try {
      const data = await crm.createProspectTask(req.me, req.params.id, req.body)
      return data ? reply.code(201).send({ success: true, data }) : notFound(reply)
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.patch('/api/prospects/:id/tasks/:taskId', { ...auth, schema: { params: ProspectTaskParamsSchema, body: UpdateProspectTaskSchema } }, async (req, reply) => {
    try {
      const data = await crm.updateProspectTask(req.me, req.params.id, req.params.taskId, req.body)
      return data ? { success: true, data } : notFound(reply, 'errors.prospects.taskNotFound')
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/:id/tasks/:taskId', { ...auth, schema: { params: ProspectTaskParamsSchema } }, async (req, reply) => {
    try {
      const data = await crm.deleteProspectTask(req.me, req.params.id, req.params.taskId)
      return data ? { success: true } : notFound(reply, 'errors.prospects.taskNotFound')
    } catch (err) {
      return crmErrorReply(reply, err)
    }
  })
}
