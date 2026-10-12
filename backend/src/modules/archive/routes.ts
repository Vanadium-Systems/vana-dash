import { randomUUID } from 'node:crypto'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { deleteFromR2, uploadToR2 } from '../../shared/lib/r2.js'
import {
  AssignFolderSchema,
  AssignSpacesSchema,
  CreateFolderSchema,
  DeleteFileQuerySchema,
  ListFilesQuerySchema,
  ListFoldersQuerySchema,
  SearchFilesQuerySchema,
  ShareSchema,
  UpdateFileSchema,
  UpdateFolderSchema,
} from './schema.js'
import * as service from './service.js'
import { ArchiveConflictError, ArchiveNotFoundError } from './service.js'
import { ensureSpaceRoot } from './access.js'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB — arhivă personală, nu streaming video la scară
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function archiveRoutes(app: FastifyInstance) {
  // Scoped la rutele acestui plugin (encapsulare Fastify) — restul aplicației nu e afectată.
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof ArchiveNotFoundError) {
      return reply.code(404).send({ success: false, error: error.message })
    }
    if (error instanceof ArchiveConflictError) {
      return reply.code(409).send({ success: false, error: error.message })
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

  server.delete('/api/archive/folders/:id', { preHandler: [app.authenticate] }, async (req) => {
    await service.deleteFolder(req.me, (req.params as { id: string }).id)
    return { success: true }
  })

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
    if (!data) return reply.code(400).send({ success: false, error: 'Fișier lipsă' })

    // Multipart nu trece prin `schema:` Zod (mecanismul standard nu se aplică pe form-data) —
    // validăm manual. Fără asta, un folderId invalid pică urât cu 500 la INSERT (coloană uuid),
    // nu curat cu 400 — și un string gol ('') ar trece de `if (folderId)` fiindcă truthy check-ul
    // e pe variabila greșită dacă nu filtrăm explicit aici. Fără folderId, upload-ul intră în
    // spațiul omului (share target din APK) — nu poate rămâne fără folder.
    const folderIdField = data.fields.folderId
    const folderIdRaw = folderIdField && 'value' in folderIdField ? String(folderIdField.value) : ''
    const folderId = folderIdRaw || undefined
    if (folderId && !UUID_RE.test(folderId)) {
      return reply.code(400).send({ success: false, error: 'folderId invalid' })
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
        return reply.code(413).send({ success: false, error: 'Fișier prea mare (peste 200MB)' })
      }
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
        return reply.code(502).send({ success: false, error: `Upload R2 eșuat: ${String(err)}` })
      }
    }

    const safeName = data.filename.replace(/[/\\]/g, '_')
    const r2Key = `archive/${randomUUID()}-${safeName}`
    try {
      await uploadToR2(r2Key, data.file, data.mimetype)
    } catch (err) {
      return reply.code(502).send({ success: false, error: `Upload R2 eșuat: ${String(err)}` })
    }
    if (data.file.truncated) {
      // busboy nu aruncă la depășirea fileSize — trunchiază stream-ul silențios (`file.truncated
      // = true`, fără eroare), deci uploadToR2 de mai sus a reușit deja cu conținutul trunchiat.
      // Fără ștergerea explicită de aici, obiectul orfan (fără rând DB) ar rămâne definitiv în R2.
      await deleteFromR2(r2Key).catch(() => {})
      return reply.code(413).send({ success: false, error: 'Fișier prea mare (peste 200MB)' })
    }

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
      const rows = await service.listFiles(req.me, req.query)
      return { success: true, data: rows }
    },
  )

  server.get(
    '/api/archive/search',
    { preHandler: [app.authenticate], schema: { querystring: SearchFilesQuerySchema } },
    async (req) => {
      const rows = await service.searchFiles(req.me, req.query.q, req.query.tags)
      return { success: true, data: rows }
    },
  )

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
    if (!result) return reply.code(404).send({ success: false, error: 'Fișier inexistent' })
    reply.header('Content-Disposition', `attachment; filename="${result.name.replace(/"/g, "'")}"`)
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

  server.delete(
    '/api/archive/files/:id',
    { preHandler: [app.authenticate], schema: { querystring: DeleteFileQuerySchema } },
    async (req, reply) => {
      const row = await service.deleteFile(req.me, (req.params as { id: string }).id, req.query.permanent)
      if (!row) return reply.code(404).send({ success: false, error: 'Fișier inexistent' })
      return { success: true }
    },
  )

  server.get(
    '/api/archive/folders/:id/download',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await service.buildFolderZipBuffer(req.me, (req.params as { id: string }).id)
      if (!result) return reply.code(404).send({ success: false, error: 'Folder inexistent' })
      reply.header('Content-Disposition', `attachment; filename="${result.fileName.replace(/"/g, "'")}"`)
      return reply.type('application/zip').send(result.buffer)
    },
  )

  server.get('/api/archive/storage', { preHandler: [app.authenticate] }, async (req) => {
    return { success: true, data: await service.getStorageUsage(req.me) }
  })

  server.get('/api/archive/folders/:id/path', { preHandler: [app.authenticate] }, async (req, reply) => {
    const path = await service.getFolderPath(req.me, (req.params as { id: string }).id).catch(
      (err) => {
        if (err instanceof ArchiveNotFoundError) return null
        throw err
      },
    )
    if (!path) return reply.code(404).send({ success: false, error: 'Folder inexistent' })
    return { success: true, data: path }
  })
}