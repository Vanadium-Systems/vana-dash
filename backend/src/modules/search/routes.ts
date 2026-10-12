import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { search } from './service.js'

// Căutarea din Ctrl K. `q` de minimum 2 caractere: cu unul, serverul ar întreba trei tabele
// pentru un prefix care potrivește orice.
const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(10).optional(),
})

export async function searchRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/search', { preHandler: [app.authenticate], schema: { querystring: SearchQuerySchema } }, async (req) => {
    return { success: true, data: await search(req.me, req.query.q, { limit: req.query.limit }) }
  })
}
