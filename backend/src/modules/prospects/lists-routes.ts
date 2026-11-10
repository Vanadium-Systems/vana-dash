import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import { prospectErrorReply } from './routes.js'
import { FolderNotFoundError } from './lists-service.js'
import {
  AddMembersSchema,
  CreateFolderSchema,
  CreateListSchema,
  IdParamsSchema,
  RemoveMembersSchema,
  UpdateFolderSchema,
  UpdateListSchema,
} from './lists-schema.js'
import * as lists from './lists-service.js'

type NotFoundKey = 'errors.prospects.listNotFound' | 'errors.prospects.folderNotFound'

/** List folders and static lists. Static paths win over `/api/prospects/:id`. */
export async function prospectListsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }
  const notFound = (reply: FastifyReply, key: NotFoundKey) => reply.code(404).send({ success: false, error: tr(key) })
  const listsErrorReply = (reply: FastifyReply, err: unknown) =>
    err instanceof FolderNotFoundError ? notFound(reply, 'errors.prospects.folderNotFound') : prospectErrorReply(reply, err)

  // ── List folders ──
  server.get('/api/prospects/list-folders', auth, async (req) => ({ success: true, data: await lists.listFolders(req.me) }))

  server.post('/api/prospects/list-folders', { ...auth, schema: { body: CreateFolderSchema } }, async (req, reply) => {
    return reply.code(201).send({ success: true, data: await lists.createFolder(req.me, req.body) })
  })

  server.patch('/api/prospects/list-folders/:id', { ...auth, schema: { params: IdParamsSchema, body: UpdateFolderSchema } }, async (req, reply) => {
    const data = await lists.updateFolder(req.me, req.params.id, req.body)
    return data ? { success: true, data } : notFound(reply, 'errors.prospects.folderNotFound')
  })

  server.delete('/api/prospects/list-folders/:id', { ...auth, schema: { params: IdParamsSchema } }, async (req, reply) => {
    return (await lists.deleteFolder(req.me, req.params.id)) ? { success: true } : notFound(reply, 'errors.prospects.folderNotFound')
  })

  // ── Lists ──
  server.get('/api/prospects/lists', auth, async (req) => ({ success: true, data: await lists.listLists(req.me) }))

  server.post('/api/prospects/lists', { ...auth, schema: { body: CreateListSchema } }, async (req, reply) => {
    try {
      return reply.code(201).send({ success: true, data: await lists.createList(req.me, req.body) })
    } catch (err) {
      return listsErrorReply(reply, err)
    }
  })

  server.patch('/api/prospects/lists/:id', { ...auth, schema: { params: IdParamsSchema, body: UpdateListSchema } }, async (req, reply) => {
    try {
      const data = await lists.updateList(req.me, req.params.id, req.body)
      return data ? { success: true, data } : notFound(reply, 'errors.prospects.listNotFound')
    } catch (err) {
      return listsErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/lists/:id', { ...auth, schema: { params: IdParamsSchema } }, async (req, reply) => {
    return (await lists.deleteList(req.me, req.params.id)) ? { success: true } : notFound(reply, 'errors.prospects.listNotFound')
  })

  server.post('/api/prospects/lists/:id/members', { ...auth, schema: { params: IdParamsSchema, body: AddMembersSchema } }, async (req, reply) => {
    try {
      const data = await lists.addMembers(req.me, req.params.id, req.body)
      return data ? { success: true, data } : notFound(reply, 'errors.prospects.listNotFound')
    } catch (err) {
      return listsErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/lists/:id/members', { ...auth, schema: { params: IdParamsSchema, body: RemoveMembersSchema } }, async (req, reply) => {
    const data = await lists.removeMembers(req.me, req.params.id, req.body.ids)
    return data ? { success: true, data } : notFound(reply, 'errors.prospects.listNotFound')
  })
}
