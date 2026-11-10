import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { interpretPhrase, NlFiltersError } from './nl-filters-service.js'

const STATUS_BY_CODE = { ASSISTANT_FORBIDDEN: 403, ASSISTANT_NOT_CONFIGURED: 409, ASSISTANT_QUOTA: 429 } as const

/** Phrase → filters; registered by `prospectsRoutes`. Read-only, so it sits under `clienti.view` in the catalog. */
export async function nlFiltersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  server.post(
    '/api/prospects/nl-filters',
    { preHandler: [app.authenticate], schema: { body: z.object({ text: z.string().trim().min(1).max(300) }) } },
    async (req, reply) => {
      try {
        return { success: true, data: await interpretPhrase(req.me, req.body.text) }
      } catch (err) {
        if (err instanceof NlFiltersError) return reply.code(STATUS_BY_CODE[err.code]).send({ success: false, error: { code: err.code, message: err.message } })
        throw err
      }
    },
  )
}
