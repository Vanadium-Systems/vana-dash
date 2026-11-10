import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import multipart from '@fastify/multipart'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { StorageFullError, assertStorageAvailable } from '../../shared/lib/storage-quota.js'
import { tr } from '../../shared/lib/i18n.js'
import { deleteFromR2, getPresignedDownloadUrl, uploadToR2 } from '../../shared/lib/r2.js'
import { prospectErrorReply } from './routes.js'
import * as voice from './voice-notes-service.js'

const ProspectParams = z.object({ id: z.string().uuid() })
const VoiceParams = z.object({ id: z.string().uuid(), vid: z.string().uuid() })
const SNIFF_BYTES = 12

function voiceErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof voice.VoiceNotYoursError) return reply.code(403).send({ success: false, error: { code: err.code, message: tr('errors.prospects.voiceNotYours') } })
  if (err instanceof voice.VoiceTaskInvalidError) return reply.code(400).send({ success: false, error: tr('errors.prospects.voiceTaskInvalid') })
  if (err instanceof StorageFullError) {
    const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
    return reply.code(413).send({
      success: false,
      error: tr('errors.archive.storageFull', { used: gb(err.usedBytes), limit: gb(err.limitBytes) }),
      code: 'STORAGE_FULL',
    })
  }
  return prospectErrorReply(reply, err)
}

export async function prospectVoiceNotesRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: voice.MAX_VOICE_BYTES, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }
  const notFound = (reply: FastifyReply) => reply.code(404).send({ success: false, error: tr('errors.prospects.voiceNotFound') })
  const prospectNotFound = (reply: FastifyReply) => reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })

  server.get('/api/prospects/:id/voice-notes', { ...auth, schema: { params: ProspectParams } }, async (req, reply) => {
    const data = await voice.listVoiceNotes(req.me, req.params.id)
    return data ? { success: true, data } : prospectNotFound(reply)
  })

  server.post('/api/prospects/:id/voice-notes', { ...auth, schema: { params: ProspectParams } }, async (req, reply) => {
    try {
      const prospectId = req.params.id
      if (!(await voice.assertVoiceTarget(req.me, prospectId))) return prospectNotFound(reply)
      if (!voice.isVoiceStorageOn()) {
        return reply.code(503).send({ success: false, error: tr('errors.prospects.voiceStorageOff'), code: 'VOICE_STORAGE_OFF' })
      }

      const part = await req.file()
      if (!part) return reply.code(400).send({ success: false, error: tr('errors.prospects.voiceNoFile') })
      const field = (name: string) => {
        const f = part.fields[name]
        return f && !Array.isArray(f) && 'value' in f ? String(f.value) : undefined
      }
      const durationSeconds = Number(field('durationSeconds'))
      const caption = field('caption')?.trim().slice(0, 200)
      const taskId = field('taskId') || undefined
      if (taskId && !z.string().uuid().safeParse(taskId).success) throw new voice.VoiceTaskInvalidError()
      await voice.assertVoiceTarget(req.me, prospectId, taskId)

      // Buffer just the head to sniff the type, then stream the rest on to R2.
      const chunks = part.file[Symbol.asyncIterator]()
      const head: Buffer[] = []
      let headLength = 0
      let ended = false
      while (headLength < SNIFF_BYTES && !ended) {
        const next = await chunks.next()
        if (next.done) ended = true
        else {
          head.push(next.value as Buffer)
          headLength += (next.value as Buffer).length
        }
      }
      const headBuffer = Buffer.concat(head)
      const kind = voice.sniffAudio(headBuffer)
      if (!kind) {
        part.file.resume()
        return reply.code(415).send({ success: false, error: tr('errors.prospects.voiceUnsupported'), code: 'VOICE_UNSUPPORTED' })
      }

      await assertStorageAvailable(1)
      const body = Readable.from(
        (async function* () {
          yield headBuffer
          if (!ended) for (;;) {
            const next = await chunks.next()
            if (next.done) return
            yield next.value as Buffer
          }
        })(),
      )
      const r2Key = `prospect-voice/${randomUUID()}.${kind.ext}`
      try {
        await uploadToR2(r2Key, body, kind.mime)
      } catch (err) {
        await deleteFromR2(r2Key).catch(() => {})
        req.log.error({ err }, 'voice note upload failed')
        return reply.code(502).send({ success: false, error: tr('errors.files.uploadFailed', { err: String(err) }) })
      }
      // busboy truncates silently past the limit: the object just uploaded is a cut-off file.
      if (part.file.truncated) {
        await deleteFromR2(r2Key).catch(() => {})
        return reply.code(413).send({ success: false, error: tr('errors.prospects.voiceTooLarge') })
      }
      const sizeBytes = part.file.bytesRead
      try {
        await assertStorageAvailable(sizeBytes)
      } catch (err) {
        await deleteFromR2(r2Key).catch(() => {})
        throw err
      }

      const created = await voice.createVoiceNote(req.me, prospectId, {
        r2Key,
        mime: kind.mime,
        sizeBytes,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
        caption,
        taskId,
      })
      return reply.code(201).send({ success: true, data: created })
    } catch (err) {
      return voiceErrorReply(reply, err)
    }
  })

  server.patch(
    '/api/prospects/:id/voice-notes/:vid',
    { ...auth, schema: { params: VoiceParams, body: voice.UpdateVoiceNoteSchema } },
    async (req, reply) => {
      try {
        const data = await voice.updateVoiceCaption(req.me, req.params.id, req.params.vid, req.body.caption)
        return data ? { success: true, data } : notFound(reply)
      } catch (err) {
        return voiceErrorReply(reply, err)
      }
    },
  )

  server.delete('/api/prospects/:id/voice-notes/:vid', { ...auth, schema: { params: VoiceParams } }, async (req, reply) => {
    try {
      const deleted = await voice.deleteVoiceNote(req.me, req.params.id, req.params.vid)
      if (!deleted) return notFound(reply)
      await deleteFromR2(deleted.r2Key).catch((err) => req.log.warn({ err, r2Key: deleted.r2Key }, 'voice note object not removed from R2'))
      return { success: true }
    } catch (err) {
      return voiceErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/:id/voice-notes/:vid/audio', { ...auth, schema: { params: VoiceParams } }, async (req, reply) => {
    const r2Key = await voice.voiceNoteKey(req.me, req.params.id, req.params.vid)
    if (!r2Key) return notFound(reply)
    const url = await getPresignedDownloadUrl(r2Key, 3600, 'inline')
    return reply.redirect(url, 302)
  })
}
