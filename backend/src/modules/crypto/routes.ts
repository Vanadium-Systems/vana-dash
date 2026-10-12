import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  CoinChartQuerySchema,
  CoinIdParamsSchema,
  ConnectExchangeSchema,
  CryptoSettingsSchema,
  ExchangeIdParamsSchema,
  MarketsQuerySchema,
  OrderPreviewSchema,
  PlaceOrderSchema,
  SearchQuerySchema,
  WatchlistEntrySchema,
} from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'

export async function cryptoRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/crypto/markets', { preHandler: [app.authenticate], schema: { querystring: MarketsQuerySchema } }, async (req) => {
    const data = await service.listMarketsPage(req.query.page, req.query.category, req.query.limit)
    return { success: true, data }
  })

  server.get(
    '/api/crypto/coin/:id',
    { preHandler: [app.authenticate], schema: { params: CoinIdParamsSchema } },
    async (req, reply) => {
      const coin = await service.getCoinDetails(req.params.id)
      if (!coin) return reply.code(404).send({ success: false, error: tr('errors.trading.coinNotFound') })
      return { success: true, data: coin }
    },
  )

  server.get(
    '/api/crypto/coin/:id/chart',
    { preHandler: [app.authenticate], schema: { params: CoinIdParamsSchema, querystring: CoinChartQuerySchema } },
    async (req) => {
      return { success: true, data: { points: await service.getCoinChart(req.params.id, req.query.days) } }
    },
  )

  server.get(
    '/api/crypto/coin/:id/candles',
    { preHandler: [app.authenticate], schema: { params: CoinIdParamsSchema, querystring: CoinChartQuerySchema } },
    async (req) => {
      return { success: true, data: { candles: await service.getCoinCandles(req.params.id, req.query.days) } }
    },
  )

  // Căutare combinată: coinuri CEX (CoinGecko) + pool-uri DEX (GeckoTerminal, cu rețea) —
  // memecoins nelistate pe Binance se pot urmări și alerta, nu trada (Contract D).
  server.get('/api/crypto/search', { preHandler: [app.authenticate], schema: { querystring: SearchQuerySchema } }, async (req) => {
    return { success: true, data: await service.searchMarkets(req.query.q) }
  })

  server.get('/api/crypto/watchlist', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getWatchlist() }
  })

  server.get('/api/crypto/watchlist/prices', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getWatchlistPrices() }
  })

  server.post('/api/crypto/watchlist', { preHandler: [app.authenticate], schema: { body: WatchlistEntrySchema } }, async (req) => {
    return { success: true, data: await service.addToWatchlist(req.body) }
  })

  server.delete(
    '/api/crypto/watchlist/:kind/:id',
    { preHandler: [app.authenticate], schema: { params: z.object({ kind: z.enum(['cex', 'dex']), id: z.string().min(1).max(120) }) } },
    async (req) => {
      return { success: true, data: await service.removeFromWatchlist(req.params.kind, req.params.id) }
    },
  )

  server.get('/api/crypto/portfolio', { preHandler: [app.authenticate], schema: { querystring: z.object({ exchange: z.enum(['binance', 'binance_testnet']).default('binance') }) } }, async (req) => {
    return { success: true, data: await service.getPortfolio(req.query.exchange) }
  })

  server.get('/api/crypto/orders', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listRecentOrders() }
  })

  server.get(
    '/api/crypto/trades',
    { preHandler: [app.authenticate], schema: { querystring: z.object({ exchange: z.enum(['binance', 'binance_testnet']).default('binance'), symbol: z.string().trim().regex(/^[A-Z0-9]{5,20}$/).optional() }) } },
    async (req) => {
      return { success: true, data: await service.listTrades(req.query.exchange, req.query.symbol) }
    },
  )

  // Preview — primul pas din confirmarea în doi pași (nu execută nimic).
  server.post('/api/crypto/orders/preview', { preHandler: [app.authenticate], schema: { body: OrderPreviewSchema } }, async (req) => {
    try {
      return { success: true, data: await service.previewOrder(req.body) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  server.post('/api/crypto/orders', { preHandler: [app.authenticate], schema: { body: PlaceOrderSchema } }, async (req) => {
    try {
      return { success: true, data: await service.placeOrder(req.body) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Exchanges + kill-switch (Setări → Crypto) ───────────────────────────────

  server.get('/api/crypto/exchanges', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listExchanges() }
  })

  server.put(
    '/api/crypto/exchanges/:exchange',
    { preHandler: [app.authenticate], schema: { params: ExchangeIdParamsSchema, body: ConnectExchangeSchema.omit({ exchange: true }) } },
    async (req) => {
      await service.connectExchange({ ...req.body, exchange: req.params.exchange })
      return { success: true, data: await service.listExchanges() }
    },
  )

  server.delete(
    '/api/crypto/exchanges/:exchange',
    { preHandler: [app.authenticate], schema: { params: ExchangeIdParamsSchema } },
    async (req) => {
      await service.disconnectExchange(req.params.exchange)
      return { success: true, data: await service.listExchanges() }
    },
  )

  server.get('/api/crypto/settings', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: { tradingEnabled: await service.isTradingEnabled() } }
  })

  server.put('/api/crypto/settings', { preHandler: [app.authenticate], schema: { body: CryptoSettingsSchema } }, async (req) => {
    return { success: true, data: { tradingEnabled: await service.setTradingEnabled(req.body.tradingEnabled) } }
  })
}
