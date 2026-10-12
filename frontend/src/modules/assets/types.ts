import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
export type AssetCategory = 'stock' | 'etf' | 'metal'

export interface WatchEntry {
  category: AssetCategory
  symbol: string
  name: string
}

export interface WatchPrice {
  entry: WatchEntry
  priceUsd: number | null
  changePct: number | null
  sparkline: number[]
}

export interface SearchResult {
  symbol: string
  description: string
  type: string
}

export interface IndexQuote {
  symbol: string
  name: string
  priceUsd: number | null
  changePct: number | null
}

export interface AssetDetail {
  symbol: string
  name: string
  category: AssetCategory
  priceUsd: number | null
  change: number | null
  changePct: number | null
  open: number | null
  high: number | null
  low: number | null
  previousClose: number | null
  exchange: string | null
  industry: string | null
  marketCapUsd: number | null
  sharesOutstanding: number | null
  ipoDate: string | null
  logoUrl: string | null
  websiteUrl: string | null
}

export interface ChartBar {
  t: number
  o: number
  h: number
  l: number
  c: number
}

export interface BrokerStatus {
  broker: 'trading212'
  mode: 'paper' | 'live'
  enabled: boolean
  apiKeyMasked: string
  connectedAt: string
}

export interface PriceProviderStatus {
  provider: 'finnhub' | 'twelvedata'
  enabled: boolean
  apiKeyMasked: string
}

export interface PortfolioPosition {
  source: 'paper' | 'live'
  symbol: string
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
  estimatedValue: number | null
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

export function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—'
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M$`
  if (Math.abs(value) >= 1000) return `${value.toLocaleString(intlTag(), { maximumFractionDigits: 0 })}$`
  return `${value.toLocaleString(intlTag(), { maximumFractionDigits: 2 })}$`
}

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  stock: t('common:nav.stocks'),
  etf: t('assets:categories.etfs'),
  metal: t('assets:categories.metals'),
}
