import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import { CreateSignalSchema, ScoringPreviewSchema, SignalParamsSchema, UpdateSignalSchema } from './score-signals-schema.js'
import * as scoreSignals from './score-signals-service.js'

/** Maps the errors of the score and signals writes; anything else goes to the app handler. */
export function scoreSignalsErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof scoreSignals.ScoringForbiddenError) return reply.code(403).send({ success: false, error: tr('errors.prospects.scoringForbidden'), code: err.code })
  if (err instanceof scoreSignals.SignalBuiltinError) return reply.code(400).send({ success: false, error: tr('errors.prospects.signalBuiltin'), code: err.code })
  throw err
}

/** Score preview and signals; registered by `prospectsRoutes`. Static paths win over `/api/prospects/:id`. */
export async function scoreSignalsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }
  const notFound = (reply: FastifyReply) => reply.code(404).send({ success: false, error: tr('errors.prospects.signalNotFound') })

  // POST is `clienti.prospectare` in the catalog; the preview is for whoever can edit the score.
  server.post('/api/prospects/scoring/preview', { ...auth, schema: { body: ScoringPreviewSchema } }, async (req, reply) => {
    try {
      scoreSignals.assertCanConfigureScoring(req.me)
      return { success: true, data: await scoreSignals.previewScoring(req.body) }
    } catch (err) {
      return scoreSignalsErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/signals', auth, async () => ({ success: true, data: await scoreSignals.listSignals() }))

  server.post('/api/prospects/signals', { ...auth, schema: { body: CreateSignalSchema } }, async (req, reply) => {
    try {
      scoreSignals.assertCanConfigureScoring(req.me)
      return reply.code(201).send({ success: true, data: await scoreSignals.createSignal(req.body) })
    } catch (err) {
      return scoreSignalsErrorReply(reply, err)
    }
  })

  server.patch('/api/prospects/signals/:id', { ...auth, schema: { params: SignalParamsSchema, body: UpdateSignalSchema } }, async (req, reply) => {
    try {
      scoreSignals.assertCanConfigureScoring(req.me)
      const data = await scoreSignals.updateSignal(req.params.id, req.body)
      return data ? { success: true, data } : notFound(reply)
    } catch (err) {
      return scoreSignalsErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/signals/:id', { ...auth, schema: { params: SignalParamsSchema } }, async (req, reply) => {
    try {
      scoreSignals.assertCanConfigureScoring(req.me)
      return (await scoreSignals.deleteSignal(req.params.id)) ? { success: true } : notFound(reply)
    } catch (err) {
      return scoreSignalsErrorReply(reply, err)
    }
  })
}
