import { z } from 'zod'

// The snapshot the bot's export sends every 5 minutes. Unknown keys are ignored (not a 400):
// the export can add fields ahead of the dashboard without breaking the ingest.

const isoDate = z.string().datetime({ offset: true })
const symbol = z.string().min(1).max(40)
const shortText = z.string().max(500)

const ServiceSchema = z.object({
  name: z.string().min(1).max(100),
  state: z.string().min(1).max(40),
})

const HoldingSchema = z.object({
  symbol,
  qty: z.number().finite(),
  valueUsdt: z.number().finite(),
})

export const StrategyKeySchema = z.string().min(1).max(40)

const StrategySchema = z.object({
  key: StrategyKeySchema,
  label: z.string().min(1).max(120),
  startEquity: z.number().finite(),
  equity: z.number().finite(),
  cash: z.number().finite(),
  maxDdPct: z.number().finite(),
  trades: z.number().int().min(0),
  feesUsdt: z.number().finite(),
  startedAt: isoDate.nullable(),
  holdings: z.array(HoldingSchema).max(100),
})

const EquityPointSchema = z.object({
  key: StrategyKeySchema,
  ts: isoDate,
  equity: z.number().finite(),
})

const TradeSchema = z.object({
  sourceId: z.string().min(1).max(80),
  ts: isoDate,
  strategy: StrategyKeySchema,
  subAccount: z.string().max(80).nullable().optional(),
  symbol,
  side: z.enum(['buy', 'sell', 'long', 'short', 'flat']),
  qty: z.number().finite(),
  price: z.number().finite(),
  feeUsdt: z.number().finite(),
  reason: shortText.nullable().optional(),
})

const NewsSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().url().max(2000),
  publishedAt: isoDate.nullable(),
  sentiment: z.string().max(40).nullable(),
  importance: z.number().finite().nullable(),
  coins: z.array(z.string().max(20)).max(20),
})

export const ReviewSeveritySchema = z.enum(['ok', 'warn', 'critical'])
export const ReviewKindSchema = z.enum(['daily', 'weekly'])

const ReviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: ReviewKindSchema,
  severity: ReviewSeveritySchema,
  summary: z.string().min(1).max(1000),
  markdown: z.string().max(64 * 1024),
})

// Contract C.1 (2026-09-25) — știrile de bursă etichetate de Jeff. `category` e tipul de eveniment
// (rezultate, Fed, inflație, tarife, geopolitică), `etfs` ce ETF-uri atinge.
const StockNewsSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().url().max(2000),
  publishedAt: isoDate.nullable(),
  sentiment: z.string().max(40).nullable(),
  importance: z.number().finite().nullable(),
  category: z.string().max(60).nullable(),
  etfs: z.array(symbol).max(20),
})

// Contract C (PLAN.md, 2026-09-25) — portofoliul pe hârtie pe ETF-uri americane. Valorile sunt
// în `currency` (USD) chiar dacă câmpurile păstrează numele din Contract A (`valueUsdt`, `feeUsdt`).
const StocksSchema = z.object({
  currency: z.string().min(1).max(10),
  session: z.object({
    isOpen: z.boolean(),
    nextOpen: isoDate.nullable(),
    nextClose: isoDate.nullable(),
  }),
  broker: z.object({
    name: z.string().min(1).max(40),
    mode: z.enum(['paper', 'live']),
    ok: z.boolean(),
    error: shortText.nullable(),
  }),
  prices: z
    .array(z.object({ symbol, price: z.number().finite().nullable(), asOf: isoDate.nullable(), ageSec: z.number().nullable() }))
    .max(50),
  strategies: z.array(StrategySchema).max(20),
  equityPoints: z.array(EquityPointSchema).max(2000),
  trades: z.array(TradeSchema).max(200),
  news: z.array(StockNewsSchema).max(50).default([]),
})

export const JeffbotSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDate,
  host: z.string().min(1).max(100),
  services: z.array(ServiceSchema).max(30),
  data: z.object({
    prices: z
      .array(z.object({ symbol, lastCandleAgeSec: z.number().nullable(), price: z.number().finite().nullable() }))
      .max(50),
    news: z.object({
      total: z.number().int().min(0),
      last24h: z.number().int().min(0),
      labeled: z.number().int().min(0),
      lastLabeledAgeSec: z.number().nullable(),
    }),
    sourceErrors: z.array(z.object({ source: z.string().min(1).max(60), error: shortText, sinceSec: z.number().nullable() })).max(30),
    fearGreed: z.object({ value: z.number().int().min(0).max(100), label: z.string().max(40) }).nullable(),
  }),
  model: z.object({
    promoted: z.boolean(),
    file: z.string().max(300).nullable(),
    holdoutRetPct: z.number().finite().nullable(),
    trainedAt: isoDate.nullable(),
    trainLogTail: z.array(shortText).max(20),
  }),
  strategies: z.array(StrategySchema).max(20),
  equityPoints: z.array(EquityPointSchema).max(2000),
  trades: z.array(TradeSchema).max(200),
  news: z.array(NewsSchema).max(50),
  reviews: z.array(ReviewSchema).max(10),
  stocks: StocksSchema.optional(),
})

export type JeffbotSnapshot = z.infer<typeof JeffbotSnapshotSchema>
type Stocks = z.infer<typeof StocksSchema>
export type StocksStatePayload = Omit<Stocks, 'equityPoints' | 'trades'>
// Ce se păstrează în jeffbot_state.payload — seriile care se acumulează au tabelele lor.
export type JeffbotStatePayload = Omit<JeffbotSnapshot, 'equityPoints' | 'trades' | 'reviews' | 'stocks'> & {
  stocks?: StocksStatePayload
}

export const MarketSchema = z.enum(['crypto', 'stocks'])
export type Market = z.infer<typeof MarketSchema>

export const OverviewQuerySchema = z.object({ market: MarketSchema.default('crypto') })

export const EquityQuerySchema = z.object({
  days: z.enum(['7', '30', '90', 'all']).default('30'),
  market: MarketSchema.default('crypto'),
})

export const ReviewIdParamsSchema = z.object({ id: z.string().uuid() })
