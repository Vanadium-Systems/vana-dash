export interface MarketCoin {
  id: string
  symbol: string
  name: string
  priceUsd: number | null
  change24h: number | null
  marketCapUsd: number | null
  sparkline: number[]
}

export interface SearchCoin {
  id: string
  symbol: string
  name: string
  thumb: string
}

export interface DexPool {
  poolId: string
  network: string
  dex: string
  name: string
  address: string
  priceUsd: number | null
  change24h: number | null
}

export interface WatchEntry {
  kind: 'cex' | 'dex'
  id: string
  symbol: string
  name: string
  network?: string
  address?: string
  dex?: string
}

export interface WatchPrice {
  entry: WatchEntry
  priceUsd: number | null
  change24h: number | null
  sparkline: number[]
}

export interface ExchangeStatus {
  exchange: 'binance' | 'binance_testnet'
  mode: 'paper' | 'live'
  enabled: boolean
  apiKeyMasked: string
  connectedAt: string
}

export interface PortfolioPosition {
  source: 'paper' | 'live'
  asset: string
  qty: number
  avgCostUsd: number | null
  priceUsd: number | null
  valueUsd: number | null
  unrealizedPnlUsd: number | null
}

export interface OrderPreviewResult {
  symbol: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity: number
  limitPrice: number | null
  referencePrice: number | null
  estimatedQuoteValue: number | null
  mode: 'paper' | 'live'
  tradingEnabled: boolean
}

export interface PaperOrderRow {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  orderType: 'market' | 'limit'
  quantity: string
  limitPrice: string | null
  executedPrice: string | null
  status: 'open' | 'filled' | 'cancelled'
  executedAt: string | null
  createdAt: string
}

export interface CoinDetails {
  id: string
  symbol: string
  name: string
  image: string
  rank: number | null
  priceUsd: number | null
  change24h: number | null
  change7d: number | null
  change30d: number | null
  marketCapUsd: number | null
  volume24hUsd: number | null
  circulatingSupply: number | null
  totalSupply: number | null
  maxSupply: number | null
  athUsd: number | null
  athChangePct: number | null
  athDate: string | null
  atlUsd: number | null
  atlChangePct: number | null
  atlDate: string | null
  description: string | null
}

export interface ChartPoint {
  t: number
  p: number
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—'
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M$`
  if (Math.abs(value) >= 1000) return `${value.toLocaleString('ro-RO', { maximumFractionDigits: 0 })}$`
  if (Math.abs(value) >= 1) return `${value.toLocaleString('ro-RO', { maximumFractionDigits: 2 })}$`
  // memecoins sub 1$ — semnificative până la 6 zecimale
  return `${value.toPrecision(4)}$`
}
