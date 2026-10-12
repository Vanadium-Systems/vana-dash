import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
})

export const AssetDetailParamsSchema = z.object({
  category: z.enum(['stock', 'etf', 'metal']),
  symbol: z.string().trim().min(1).max(20),
})

export const AssetChartQuerySchema = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.literal(365)])).default(7),
})

export const IndexListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(50).default(1),
  limit: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50)])).default(25),
  q: z.string().trim().max(80).optional(),
})

export const WatchlistEntrySchema = z.object({
  category: z.enum(['stock', 'etf', 'metal']),
  // Simbolul provider-ului de preț (Finnhub pt. stock/etf, Twelve Data pt. metal — ex: XAU/USD).
  // NU e neapărat ticker-ul Trading212 (vezi PlaceOrderSchema).
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
})

// Fără `broker` (mereu 'trading212', vine din params) — ruta îl adaugă separat, ca să poată
// folosi schema direct în `body` (un `.refine()` nu mai suportă `.omit()` după el).
export const ConnectBrokerBodySchema = z
  .object({
    // Opțională pe paper — modul paper nu atinge NICIODATĂ API-ul Trading212 (fill la preț
    // Finnhub/Twelve Data), iar Trading212 cere cont alimentat înainte să emită o cheie API.
    // Obligatorie doar când `mode: 'live'`.
    apiKey: z.string().trim().min(16).max(200).optional(),
    mode: z.enum(['paper', 'live']).default('paper'),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.mode !== 'live' || v.apiKey !== undefined, {
    message: lazyTr('errors.trading.liveNeedsT212Key'),
    path: ['apiKey'],
  })

export const BrokerIdParamsSchema = z.object({ broker: z.literal('trading212') })

export const ConnectPriceProviderSchema = z.object({
  provider: z.enum(['finnhub', 'twelvedata']),
  apiKey: z.string().trim().min(8).max(200),
})

export const PriceProviderParamsSchema = z.object({ provider: z.enum(['finnhub', 'twelvedata']) })

export const OrderPreviewSchema = z.object({
  // Preview + paper: simbol Finnhub/Twelve Data (AAPL, XAU/USD). Live: ticker Trading212 exact
  // (AAPL_US_EQ) — vezi comentariul din service.ts. Regex permisiv, validat mai departe la apel.
  symbol: z.string().trim().min(1).max(20),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  quantity: z.number().positive().max(1e9),
  limitPrice: z.number().positive().optional(),
}).refine((v) => v.type !== 'limit' || v.limitPrice !== undefined, {
  message: lazyTr('errors.trading.limitNeedsPrice'),
  path: ['limitPrice'],
})

export const PlaceOrderSchema = OrderPreviewSchema

export const AssetsSettingsSchema = z.object({
  // Kill-switch global — false blochează DOAR ordinele live; paper-ul rămâne disponibil.
  tradingEnabled: z.boolean(),
})
