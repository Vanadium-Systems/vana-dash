import { randomUUID } from 'node:crypto'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { deleteFromR2, uploadToR2 } from '../../shared/lib/r2.js'
import {
  AssignFolderSchema,
  AssignSpacesSchema,
  BulkDeleteSchema,
  BulkMoveSchema,
  CreateFolderSchema,
  ListFilesQuerySchema,
  ListFoldersQuerySchema,
  PutBackSchema,
  SearchFilesQuerySchema,
  ShareSchema,
  StarParamsSchema,
  UpdateFileSchema,
  UpdateFolderSchema,
} from './schema.js'
import * as service from './service.js'
import * as trash from './trash.js'
import { bulkMove, putBack } from './bulk.js'
import { ArchiveConflictError, ArchiveNotFoundError, ArchiveStorageFullError } from './service.js'
import { ensureSpaceRoot } from './access.js'
import { storageUsage } from '../../shared/lib/storage-quota.js'
import { tr } from '../../shared/lib/i18n.js'
import { contentDisposition } from '../../shared/lib/text.js'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB — arhivă personală, nu streaming video la scară
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function archiveRoutes(app: FastifyInstance) {
  // Scoped la rutele acestui plugin (encapsulare Fastify) — restul aplicației nu e afectată.
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof ArchiveNotFoundError) {
      return reply.code(404).send({ success: false, error: error.message, itemId: error.itemId })
    }
    if (error instanceof ArchiveConflictError) {
      return reply.code(409).send({ success: false, error: error.message })
    }
    if (error instanceof ArchiveStorageFullError) {
      const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
      return reply.code(413).send({
        success: false,
        error: tr('errors.archive.storageFull', { used: gb(error.usedBytes), limit: gb(error.limitBytes) }),
        code: 'STORAGE_FULL',
        usedBytes: error.usedBytes,
        limitBytes: error.limitBytes,
      })
    }
    throw error
  })

  // Ecranul de sus: „Spațiul meu" + „Partajate cu mine" + (administrare) „Toate spațiile".
  server.get('/api/archive/spaces', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.listSpaces(req.me),
  }))

  server.post(
    '/api/archive/folders',
    { preHandler: [app.authenticate], schema: { body: CreateFolderSchema } },
    async (req) => {
      const row = await service.createFolder(req.me, req.body.name, req.body.parentId)
      return { success: true, data: row }
    },
  )

  server.get(
    '/api/archive/folders',
    { preHandler: [app.authenticate], schema: { querystring: ListFoldersQuerySchema } },
    async (req) => {
      // Fără `parentId` se listează rădăcina spațiului omului — pagina pornește de acolo, nu
      // de o rădăcină comună care nu mai există.
      const parentId = req.query.parentId ?? (await ensureSpaceRoot(req.me))
      const rows = await service.listFolders(req.me, parentId, req.query.sort)
      return { success: true, data: rows }
    },
  )

  server.patch(
    '/api/archive/folders/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateFolderSchema } },
    async (req) => {
      const row = await service.updateFolder(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return { success: true }
      return { success: true, data: row }
    },
  )

  // A folder goes to the Trash with everything in it; the answer is what the undo toast needs.
  server.delete('/api/archive/folders/:id', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await trash.trashFolder(req.me, (req.params as { id: string }).id),
  }))

  // Share pe folder — listă / adaugă (sau schimbă nivelul) / scoate. Dreptul îl are doar
  // proprietarul folderului sau adminul (service::assertCanShare).
  server.get('/api/archive/folders/:id/shares', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.listShares(req.me, (req.params as { id: string }).id),
  }))

  server.post(
    '/api/archive/folders/:id/shares',
    { preHandler: [app.authenticate], schema: { body: ShareSchema } },
    async (req, reply) => {
      const shares = await service.setShare(
        req.me,
        (req.params as { id: string }).id,
        req.body.userId,
        req.body.level,
      )
      return reply.code(201).send({ success: true, data: shares })
    },
  )

  server.delete(
    '/api/archive/folders/:id/shares/:userId',
    { preHandler: [app.authenticate] },
    async (req) => {
      const { id, userId } = req.params as { id: string; userId: string }
      return { success: true, data: await service.removeShare(req.me, id, userId) }
    },
  )

  // Atribuire: un folder (tot subarborele) sau toate spațiile unui om. Doar admin /
  // `arhiva.administrare` — de asta există funcționalitatea.
  server.post(
    '/api/archive/folders/:id/assign',
    { preHandler: [app.authenticate], schema: { body: AssignFolderSchema } },
    async (req) => ({
      success: true,
      data: await service.assignFolder(req.me, (req.params as { id: string }).id, req.body.ownerUserId),
    }),
  )

  server.post(
    '/api/archive/spaces/:ownerUserId/assign',
    { preHandler: [app.authenticate], schema: { body: AssignSpacesSchema } },
    async (req) => ({
      success: true,
      data: await service.assignAllSpaces(req.me, (req.params as { ownerUserId: string }).ownerUserId, req.body.toUserId),
    }),
  )

  // multipart/form-data — field-urile simple (folderId, tags) TREBUIE plasate înainte de
  // partea "file" în formular (@fastify/multipart citește stream-ul secvențial, `data.fields`
  // conține doar ce a fost parsat până la file part).
  server.post('/api/archive/files', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ success: false, error: tr('errors.files.missing') })

    // Multipart nu trece prin `schema:` Zod (mecanismul standard nu se aplică pe form-data) —
    // validăm manual. Fără asta, un folderId invalid pică urât cu 500 la INSERT (coloană uuid),
    // nu curat cu 400 — și un string gol ('') ar trece de `if (folderId)` fiindcă truthy check-ul
    // e pe variabila greșită dacă nu filtrăm explicit aici. Fără folderId, upload-ul intră în
    // spațiul omului (share target din APK) — nu poate rămâne fără folder.
    const folderIdField = data.fields.folderId
    const folderIdRaw = folderIdField && 'value' in folderIdField ? String(folderIdField.value) : ''
    const folderId = folderIdRaw || undefined
    if (folderId && !UUID_RE.test(folderId)) {
      return reply.code(400).send({ success: false, error: tr('errors.archive.invalidFolderId') })
    }
    const tagsField = data.fields.tags
    const tagsRaw = tagsField && 'value' in tagsField ? String(tagsField.value) : ''
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    // PDF-urile sunt bufferate (nu streamed direct) ca service.uploadFile() să poată genera
    // și thumbnail (shared/lib/thumbnail.ts) — streamul multipart se poate consuma o singură
    // dată. Arhivă personală, fișiere mici (facturi/documente), fără cost real de memorie.
    if (data.mimetype === 'application/pdf') {
      const buffer = await data.toBuffer()
      if (data.file.truncated) {
        return reply.code(413).send({ success: false, error: tr('errors.archive.fileTooLarge') })
      }
      await service.assertStorageAvailable(buffer.byteLength)
      try {
        const row = await service.uploadFile(req.me, {
          folderId,
          name: data.filename,
          mimeType: data.mimetype,
          buffer,
          tags,
        })
        return { success: true, data: row }
      } catch (err) {
        return reply.code(502).send({ success: false, error: tr('errors.files.uploadFailed', { err: String(err) }) })
      }
    }

    // The size of a streamed part is unknown up front: refuse when the bucket is already full,
    // and check again with the real size once the upload is done.
    await service.assertStorageAvailable(1)
    const safeName = data.filename.replace(/[/\\]/g, '_')
    const r2Key = `archive/${randomUUID()}-${safeName}`
    try {
      await uploadToR2(r2Key, data.file, data.mimetype)
    } catch (err) {
      return reply.code(502).send({ success: false, error: tr('errors.files.uploadFailed', { err: String(err) }) })
    }
    if (data.file.truncated) {
      // busboy nu aruncă la depășirea fileSize — trunchiază stream-ul silențios (`file.truncated
      // = true`, fără eroare), deci uploadToR2 de mai sus a reușit deja cu conținutul trunchiat.
      // Fără ștergerea explicită de aici, obiectul orfan (fără rând DB) ar rămâne definitiv în R2.
      await deleteFromR2(r2Key).catch(() => {})
      return reply.code(413).send({ success: false, error: tr('errors.archive.fileTooLarge') })
    }
    await service.assertStorageAvailable(data.file.bytesRead).catch(async (err) => {
      await deleteFromR2(r2Key).catch(() => {})
      throw err
    })

    const row = await service.createFileRecord(req.me, {
      folderId,
      name: data.filename,
      mimeType: data.mimetype,
      sizeBytes: data.file.bytesRead,
      r2Key,
      tags,
    })
    return { success: true, data: row }
  })

  server.get(
    '/api/archive/files',
    { preHandler: [app.authenticate], schema: { querystring: ListFilesQuerySchema } },
    async (req) => {
      return { success: true, data: await service.listFiles(req.me, req.query) }
    },
  )

  server.get(
    '/api/archive/search',
    { preHandler: [app.authenticate], schema: { querystring: SearchFilesQuerySchema } },
    async (req) => {
      return { success: true, data: await service.searchArchive(req.me, req.query) }
    },
  )

  server.get('/api/archive/recent', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.listRecent(req.me),
  }))

  server.get('/api/archive/stars', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.listStars(req.me),
  }))

  server.put(
    '/api/archive/stars/:type/:id',
    { preHandler: [app.authenticate], schema: { params: StarParamsSchema } },
    async (req) => ({ success: true, data: await service.setStar(req.me, req.params.type, req.params.id) }),
  )

  server.delete(
    '/api/archive/stars/:type/:id',
    { preHandler: [app.authenticate], schema: { params: StarParamsSchema } },
    async (req) => ({ success: true, data: await service.removeStar(req.me, req.params.type, req.params.id) }),
  )

  server.get('/api/archive/files/:id/details', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.getFileDetails(req.me, (req.params as { id: string }).id),
  }))

  server.get('/api/archive/folders/:id/details', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await service.getFolderDetails(req.me, (req.params as { id: string }).id),
  }))

  server.get(
    '/api/archive/files/:id/download-url',
    { preHandler: [app.authenticate] },
    async (req) => {
      const result = await service.getFileForDownload(req.me, (req.params as { id: string }).id)
      return { success: true, data: result }
    },
  )

  // 2026-08-11 — streaming SAME-ORIGIN prin backend (nu URL presemnat R2 direct) — vezi
  // comentariul din archive/service.ts::getFileBufferForDownload pt. de ce (CORS R2). Folosit
  // de ArchiveAttachPicker.tsx (fetch() care are nevoie să citească bytes-ii în JS pt. atașare),
  // NU de download-ul normal din UI-ul Arhivei (acela rămâne pe URL presemnat, window.open/
  // navigare directă, nesupusă CORS).
  server.get('/api/archive/files/:id/download', { preHandler: [app.authenticate] }, async (req, reply) => {
    const result = await service.getFileBufferForDownload(req.me, (req.params as { id: string }).id)
    if (!result) return reply.code(404).send({ success: false, error: tr('errors.archive.fileNotFound') })
    reply.header('Content-Disposition', contentDisposition('attachment', result.name))
    return reply.type(result.mimeType).send(result.buffer)
  })

  server.patch(
    '/api/archive/files/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateFileSchema } },
    async (req) => {
      const row = await service.updateFile(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return { success: true }
      return { success: true, data: row }
    },
  )

  // Permanent deletion happens only from the Trash (DELETE /api/archive/trash/:batchId).
  server.delete('/api/archive/files/:id', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await trash.trashFile(req.me, (req.params as { id: string }).id),
  }))

  server.get('/api/archive/trash', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await trash.listTrash(req.me),
  }))

  server.post('/api/archive/trash/:batchId/restore', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await trash.restoreBatch(req.me, (req.params as { batchId: string }).batchId),
  }))

  server.delete('/api/archive/trash/:batchId', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await trash.purgeBatchNow(req.me, (req.params as { batchId: string }).batchId),
  }))

  server.post(
    '/api/archive/bulk/move',
    { preHandler: [app.authenticate], schema: { body: BulkMoveSchema } },
    async (req) => ({ success: true, data: await bulkMove(req.me, req.body.items, req.body.targetFolderId) }),
  )

  server.post(
    '/api/archive/bulk/delete',
    { preHandler: [app.authenticate], schema: { body: BulkDeleteSchema } },
    async (req) => ({ success: true, data: await trash.trashMany(req.me, req.body.items) }),
  )

  server.post(
    '/api/archive/bulk/put-back',
    { preHandler: [app.authenticate], schema: { body: PutBackSchema } },
    async (req) => ({ success: true, data: await putBack(req.me, req.body.previous) }),
  )

  server.get(
    '/api/archive/folders/:id/download',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await service.buildFolderZipBuffer(req.me, (req.params as { id: string }).id)
      if (!result) return reply.code(404).send({ success: false, error: tr('errors.archive.folderNotFound') })
      reply.header('Content-Disposition', contentDisposition('attachment', result.fileName))
      return reply.type('application/zip').send(result.buffer)
    },
  )

  server.get('/api/archive/storage', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await service.getStorageUsage(req.me) }
  })

  server.get('/api/archive/storage-usage', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await storageUsage() }
  })

  server.get('/api/archive/folders/:id/path', { preHandler: [app.authenticate] }, async (req, reply) => {
    const path = await service.getFolderPath(req.me, (req.params as { id: string }).id).catch(
      (err) => {
        if (err instanceof ArchiveNotFoundError) return null
        throw err
      },
    )
    if (!path) return reply.code(404).send({ success: false, error: tr('errors.archive.folderNotFound') })
    return { success: true, data: path }
  })
}