import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { tr } from '../../shared/lib/i18n.js'
import { ClientPricingSchema } from '../invoicing/pricing-apply.js'
import { prospectErrorReply } from './routes.js'
import * as service from './service.js'

const IdParamsSchema = z.object({ id: z.string().uuid() })

/** The calculator quote saved on a prospect; registered by `prospectsRoutes`. */
export async function offerRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const auth = { preHandler: [app.authenticate] }

  server.put('/api/prospects/:id/offer', { ...auth, schema: { params: IdParamsSchema, body: ClientPricingSchema } }, async (req, reply) => {
    try {
      const data = await service.saveOffer(req.me, req.params.id, req.body)
      if (!data) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
      return { success: true, data }
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/:id/offer', { ...auth, schema: { params: IdParamsSchema } }, async (req, reply) => {
    try {
      if ((await service.saveOffer(req.me, req.params.id, null)) === undefined) {
        return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
      }
      return { success: true, data: null }
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })
}
