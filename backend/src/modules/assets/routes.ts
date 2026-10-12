import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  AssetChartQuerySchema,
  AssetDetailParamsSchema,
  AssetsSettingsSchema,
  BrokerIdParamsSchema,
  ConnectBrokerBodySchema,
  ConnectPriceProviderSchema,
  IndexListQuerySchema,
  OrderPreviewSchema,
  PlaceOrderSchema,
  PriceProviderParamsSchema,
  SearchQuerySchema,
  WatchlistEntrySchema,
} from './schema.js'
import * as service from './service.js'

export async function assetsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/assets/search', { preHandler: [app.authenticate], schema: { querystring: SearchQuerySchema } }, async (req) => {
    return { success: true, data: await service.searchSymbols(req.query.q) }
  })

  server.get('/api/assets/metals', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: service.METAL_OPTIONS }
  })

  server.get('/api/assets/index-list', { preHandler: [app.authenticate], schema: { querystring: IndexListQuerySchema } }, async (req) => {
    const data = await service.listIndexPage(req.query.page, req.query.limit, req.query.q)
    return { success: true, data }
  })

  // Pagina de detaliu a unui simbol (Contract nou, cerință Stefan: „cum e pe Crypto").
  server.get(
    '/api/assets/detail/:category/:symbol',
    { preHandler: [app.authenticate], schema: { params: AssetDetailParamsSchema } },
    async (req) => {
      const symbol = decodeURIComponent(req.params.symbol)
      return { success: true, data: await service.getAssetDetail(req.params.category, symbol) }
    },
  )

  server.get(
    '/api/assets/detail/:category/:symbol/chart',
    { preHandler: [app.authenticate], schema: { params: AssetDetailParamsSchema, querystring: AssetChartQuerySchema } },
    async (req) => {
      const symbol = decodeURIComponent(req.params.symbol)
      return { success: true, data: { bars: await service.getAssetChart(symbol, req.query.days) } }
    },
  )

  server.get('/api/assets/watchlist', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getWatchlist() }
  })

  server.get('/api/assets/watchlist/prices', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getWatchlistPrices() }
  })

  server.post('/api/assets/watchlist', { preHandler: [app.authenticate], schema: { body: WatchlistEntrySchema } }, async (req) => {
    return { success: true, data: await service.addToWatchlist(req.body) }
  })

  server.delete(
    '/api/assets/watchlist/:category/:symbol',
    {
      preHandler: [app.authenticate],
      schema: { params: z.object({ category: z.enum(['stock', 'etf', 'metal']), symbol: z.string().min(1).max(20) }) },
    },
    async (req) => {
      return { success: true, data: await service.removeFromWatchlist(req.params.category, decodeURIComponent(req.params.symbol)) }
    },
  )

  server.get('/api/assets/portfolio', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getPortfolio('trading212') }
  })

  server.get('/api/assets/orders', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listRecentOrders() }
  })

  server.post('/api/assets/orders/preview', { preHandler: [app.authenticate], schema: { body: OrderPreviewSchema } }, async (req) => {
    try {
      return { success: true, data: await service.previewOrder({ ...req.body, broker: 'trading212' }) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  server.post('/api/assets/orders', { preHandler: [app.authenticate], schema: { body: PlaceOrderSchema } }, async (req) => {
    try {
      return { success: true, data: await service.placeOrder({ ...req.body, broker: 'trading212' }) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Broker + provideri de preț + kill-switch (Setări → Assets) ─────────────

  server.get('/api/assets/brokers', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listBrokers() }
  })

  server.put(
    '/api/assets/brokers/:broker',
    { preHandler: [app.authenticate], schema: { params: BrokerIdParamsSchema, body: ConnectBrokerBodySchema } },
    async (req) => {
      await service.connectBroker({ ...req.body, broker: req.params.broker })
      return { success: true, data: await service.listBrokers() }
    },
  )

  server.delete(
    '/api/assets/brokers/:broker',
    { preHandler: [app.authenticate], schema: { params: BrokerIdParamsSchema } },
    async (req) => {
      await service.disconnectBroker(req.params.broker)
      return { success: true, data: await service.listBrokers() }
    },
  )

  server.get('/api/assets/price-providers', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listPriceProviders() }
  })

  server.put(
    '/api/assets/price-providers/:provider',
    { preHandler: [app.authenticate], schema: { params: PriceProviderParamsSchema, body: ConnectPriceProviderSchema.omit({ provider: true }) } },
    async (req) => {
      await service.connectPriceProvider({ ...req.body, provider: req.params.provider })
      return { success: true, data: await service.listPriceProviders() }
    },
  )

  server.delete(
    '/api/assets/price-providers/:provider',
    { preHandler: [app.authenticate], schema: { params: PriceProviderParamsSchema } },
    async (req) => {
      await service.disconnectPriceProvider(req.params.provider)
      return { success: true, data: await service.listPriceProviders() }
    },
  )

  server.get('/api/assets/settings', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: { tradingEnabled: await service.isTradingEnabled() } }
  })

  server.put('/api/assets/settings', { preHandler: [app.authenticate], schema: { body: AssetsSettingsSchema } }, async (req) => {
    return { success: true, data: { tradingEnabled: await service.setTradingEnabled(req.body.tradingEnabled) } }
  })
}
