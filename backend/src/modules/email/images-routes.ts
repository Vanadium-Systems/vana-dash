import { randomUUID } from 'node:crypto'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import { ALLOWED_MIME_TO_EXT, contentTypeForImageFilename, emailImageStoragePath, IMAGE_FILENAME_RE, MAX_IMAGE_SIZE } from './images-service.js'

export async function emailImagesRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_SIZE, files: 1 } })

  // Upload — sesiune Stefan (compune/editează un template), nu publică. URL-ul întors e folosit
  // DOAR de editor la afișare/preview — la trimitere reală, imagesService.inlineStoredImages()
  // o convertește într-un atașament MIME cu Content-ID (vezi comentariul de-acolo).
  app.post('/api/email/images', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ success: false, error: 'Fișier lipsă' })

    const ext = ALLOWED_MIME_TO_EXT[data.mimetype]
    if (!ext) {
      return reply.code(400).send({ success: false, error: `Tip de fișier neacceptat: ${data.mimetype} (doar PNG/JPEG/GIF/WEBP)` })
    }

    const buffer = await data.toBuffer()
    if (data.file.truncated) {
      return reply.code(413).send({ success: false, error: 'Poză prea mare (peste 5MB)' })
    }

    const filename = `${randomUUID()}.${ext}`
    await saveDocument(emailImageStoragePath(filename), buffer)
    return { success: true, data: { url: `/api/email-images/${filename}` } }
  })

  // Servire — PUBLIC, fără authenticate. Folosită de editor (preview live) și de reafișarea
  // unui draft/template/mesaj din thread — NU de emailul efectiv trimis (acela primește poza ca
  // atașament MIME cu cid:, vezi images-service.ts). Filename generat server-side (UUID +
  // extensie din whitelist) — regex-ul de mai jos e o a doua barieră (resolveSafe din
  // storage.ts oricum respinge orice `../`), nu singura.
  app.get('/api/email-images/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string }
    if (!IMAGE_FILENAME_RE.test(filename)) {
      return reply.code(404).send({ success: false, error: 'Poză inexistentă' })
    }

    try {
      const buffer = await readDocument(emailImageStoragePath(filename))
      // Imutabil odată încărcat (nume generat, nu se suprascrie niciodată) — cache lung, sigur.
      return reply.header('Content-Type', contentTypeForImageFilename(filename)).header('Cache-Control', 'public, max-age=31536000, immutable').send(buffer)
    } catch {
      return reply.code(404).send({ success: false, error: 'Poză inexistentă' })
    }
  })
}
