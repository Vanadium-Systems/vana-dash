import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  CreateWishlistItemSchema,
  ListWishlistQuerySchema,
  PurchaseWishlistItemSchema,
  UpdateWishlistItemSchema,
} from './schema.js'
import * as service from './service.js'

export async function wishlistRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/wishlist',
    { preHandler: [app.authenticate], schema: { querystring: ListWishlistQuerySchema } },
    async (req) => {
      const [items, totals] = await Promise.all([service.listWishlistItems(req.me, req.query), service.getWishlistTotals(req.me)])
      return { success: true, data: { items, totals } }
    },
  )

  server.post(
    '/api/wishlist',
    { preHandler: [app.authenticate], schema: { body: CreateWishlistItemSchema } },
    async (req, reply) => {
      const row = await service.createWishlistItem(req.me, req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.patch(
    '/api/wishlist/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateWishlistItemSchema } },
    async (req, reply) => {
      const row = await service.updateWishlistItem(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: 'Item inexistent' })
      return { success: true, data: row }
    },
  )

  server.delete('/api/wishlist/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteWishlistItem(req.me, (req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: 'Item inexistent' })
    return { success: true }
  })

  server.post(
    '/api/wishlist/:id/purchase',
    { preHandler: [app.authenticate], schema: { body: PurchaseWishlistItemSchema } },
    async (req, reply) => {
      const row = await service.purchaseWishlistItem(req.me, (req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: 'Item inexistent' })
      return { success: true, data: row }
    },
  )
}
