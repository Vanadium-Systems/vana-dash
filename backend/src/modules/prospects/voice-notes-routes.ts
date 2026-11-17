import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import multipart from '@fastify/multipart'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { fail } from '../../shared/lib/http-error.js'
import { StorageFullError, assertStorageAvailable } from '../../shared/lib/storage-quota.js'
import { tr } from '../../shared/lib/i18n.js'
import { deleteFromR2, getPresignedDownloadUrl, uploadToR2 } from '../../shared/lib/r2.js'
import { prospectErrorReply } from './routes.js'
import * as voice from './voice-notes-service.js'

const ProspectParams = z.object({ id: z.string().uuid() })
const VoiceParams = z.object({ id: z.string().uuid(), vid: z.string().uuid() })
const SNIFF_BYTES = 12

function voiceErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof voice.VoiceNotYoursError) return fail(reply, 403, err.code, { message: tr('errors.prospects.voiceNotYours') })
  if (err instanceof voice.VoiceTaskInvalidError) return fail(reply, 400, err.code, { message: tr('errors.prospects.voiceTaskInvalid') })
  if (err instanceof StorageFullError) {
    const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
    return fail(reply, 413, 'STORAGE_FULL', {
      message: tr('errors.archive.storageFull', { used: gb(err.usedBytes), limit: gb(err.limitBytes) }),
      details: { usedBytes: err.usedBytes, limitBytes: err.limitBytes },
    })
  }
  return prospectErrorReply(reply, err)
}

export async function prospectVoiceNotesRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: voice.MAX_VOICE_BYTES, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }
  const notFound = (reply: FastifyReply) => fail(reply, 404, 'VOICE_NOTE_NOT_FOUND', { message: tr('errors.prospects.voiceNotFound') })
  const prospectNotFound = (reply: FastifyReply) => fail(reply, 404, 'PROSPECT_NOT_FOUND', { message: tr('errors.prospects.notFound') })

  server.get('/api/prospects/:id/voice-notes', { ...auth, schema: { params: ProspectParams } }, async (req, reply) => {
    const data = await voice.listVoiceNotes(req.me, req.params.id)
    return data ? { success: true, data } : prospectNotFound(reply)
  })

  server.post('/api/prospects/:id/voice-notes', { ...auth, schema: { params: ProspectParams } }, async (req, reply) => {
    try {
      const prospectId = req.params.id
      if (!(await voice.assertVoiceTarget(req.me, prospectId))) return prospectNotFound(reply)
      if (!voice.isVoiceStorageOn()) {
        return fail(reply, 503, 'VOICE_STORAGE_OFF', { message: tr('errors.prospects.voiceStorageOff') })
      }

      const part = await req.file()
      if (!part) return fail(reply, 400, 'VOICE_NO_FILE', { message: tr('errors.prospects.voiceNoFile') })
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
        return fail(reply, 415, 'VOICE_UNSUPPORTED', { message: tr('errors.prospects.voiceUnsupported') })
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
        return fail(reply, 502, 'VOICE_UPLOAD_FAILED')
      }
      // busboy truncates silently past the limit: the object just uploaded is a cut-off file.
      if (part.file.truncated) {
        await deleteFromR2(r2Key).catch(() => {})
        return fail(reply, 413, 'VOICE_TOO_LARGE', { message: tr('errors.prospects.voiceTooLarge') })
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
