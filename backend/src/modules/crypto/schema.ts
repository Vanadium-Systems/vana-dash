import { z } from 'zod'

export const MarketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(20).default(1),
  // 'all' | 'gainers' | id-uri de categorie CoinGecko ('meme-token', 'decentralized-finance-defi', ...)
  category: z.string().trim().max(60).default('all'),
  limit: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50)])).default(25),
})

export const CoinIdParamsSchema = z.object({
  // id-urile CoinGecko sunt slug-uri lowercase cu cratime (bitcoin, baby-doge-coin)
  id: z.string().trim().regex(/^[a-z0-9-]{1,60}$/),
})

export const CoinChartQuerySchema = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.literal(365)])).default(7),
})

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
})

export const WatchlistEntrySchema = z.object({
  // 'cex' = coin CoinGecko (tradabil pe Binance dacă are pereche); 'dex' = pool GeckoTerminal
  kind: z.enum(['cex', 'dex']),
  id: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  network: z.string().trim().max(40).optional(),
  address: z.string().trim().max(120).optional(),
  dex: z.string().trim().max(60).optional(),
})

export const ConnectExchangeSchema = z.object({
  exchange: z.enum(['binance', 'binance_testnet']),
  apiKey: z.string().trim().min(16).max(128),
  apiSecret: z.string().trim().min(16).max(128),
  mode: z.enum(['paper', 'live']).default('paper'),
  enabled: z.boolean().default(true),
})

export const ExchangeIdParamsSchema = z.object({ exchange: z.enum(['binance', 'binance_testnet']) })

export const OrderPreviewSchema = z.object({
  exchange: z.enum(['binance', 'binance_testnet']),
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{5,20}$/, 'Simbol Binance invalid (ex: BTCUSDT)'),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  quantity: z.number().positive().max(1e12),
  limitPrice: z.number().positive().optional(),
}).refine((v) => v.type !== 'limit' || v.limitPrice !== undefined, {
  message: 'Ordinele limit au nevoie de limitPrice',
  path: ['limitPrice'],
})

export const PlaceOrderSchema = OrderPreviewSchema

export const CryptoSettingsSchema = z.object({
  // Kill-switch global — false blochează DOAR ordinele live; paper-ul rămâne disponibil.
  tradingEnabled: z.boolean(),
})
