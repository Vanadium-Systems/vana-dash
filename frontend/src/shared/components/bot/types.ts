import { CHART_COLORS, CHART_NEUTRAL } from '@/shared/lib/chart-colors'

// Părțile comune ale tab-urilor „Bot" din Crypto și Assets (jeffbot, PLAN.md Contract B + D).
// Specificul fiecărei piețe stă în modulul ei: crypto/bot (știri, model), assets/bot (bursa).

export type Market = 'crypto' | 'stocks'
export type ReviewSeverity = 'ok' | 'warn' | 'critical'

export interface BotHolding {
  symbol: string
  qty: number
  valueUsdt: number
}

export interface BotStrategy {
  key: string
  label: string
  startEquity: number
  equity: number
  cash: number
  maxDdPct: number
  trades: number
  feesUsdt: number
  startedAt: string | null
  holdings: BotHolding[]
}

export interface BotService {
  name: string
  state: string
}

export interface BotTrade {
  id: string
  ts: string
  strategy: string
  subAccount: string | null
  symbol: string
  side: 'buy' | 'sell' | 'long' | 'short' | 'flat'
  qty: number
  price: number
  feeUsdt: number
  reason: string | null
}

export interface ReviewMeta {
  id: string
  date: string
  kind: 'daily' | 'weekly'
  severity: ReviewSeverity
  summary: string
  receivedAt: string
}

export interface EquityPoint {
  key: string
  ts: string
  equity: number
}

export interface StockNews {
  title: string
  url: string
  publishedAt: string | null
  sentiment: string | null
  importance: number | null
  category: string | null
  etfs: string[]
}

// Contract D — GET /api/jeffbot/overview?market=stocks. Sumele sunt în `currency` (USD) chiar
// dacă câmpurile păstrează numele din Contract A (`valueUsdt`, `feeUsdt`).
export interface StocksSnapshot {
  generatedAt: string
  host: string
  services: BotService[]
  currency: string
  session: { isOpen: boolean; nextOpen: string | null; nextClose: string | null }
  broker: { name: string; mode: 'paper' | 'live'; ok: boolean; error: string | null }
  prices: { symbol: string; price: number | null; asOf: string | null; ageSec: number | null }[]
  strategies: BotStrategy[]
  news?: StockNews[] // lipsește din starea salvată înainte de Contract C.1
}

export interface StocksOverview {
  receivedAt: string
  stale: boolean
  snapshot: StocksSnapshot
  trades: BotTrade[]
  reviews: ReviewMeta[]
}

// Aceleași praguri ca în backend: `stale` după 15 min, alerta `jeffbot.offline` după 30.
const LATE_AFTER_MIN = 15
const OFFLINE_AFTER_MIN = 30

export function botStatus(ageMinutes: number): 'online' | 'late' | 'offline' {
  if (ageMinutes > OFFLINE_AFTER_MIN) return 'offline'
  if (ageMinutes > LATE_AFTER_MIN) return 'late'
  return 'online'
}

// Buy & hold e referința, nu o strategie în concurs: gri, punctat. Restul își păstrează
// culoarea indiferent de ce strategii apar în snapshot (culoarea urmează entitatea). Paleta are
// 6 sloturi, deci `gtaa` și `lgbm` împart unul: nu apar niciodată pe același grafic.
export const REFERENCE_KEY = 'hold'
const SERIES_SLOT: Record<string, number> = {
  mix: 0,
  trend200: 1,
  trend50: 2,
  rotation: 3,
  lgbm: 4,
  gtaa: 4,
  trend200x15: 5,
}

export function strategyColor(key: string): string {
  if (key === REFERENCE_KEY) return CHART_NEUTRAL
  const slot = SERIES_SLOT[key]
  return slot === undefined ? CHART_NEUTRAL : CHART_COLORS[slot]!
}

export function returnPct(s: Pick<BotStrategy, 'equity' | 'startEquity'>): number {
  return s.startEquity ? (s.equity / s.startEquity - 1) * 100 : 0
}

export function formatPct(value: number, digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`
}

export function formatMoney(value: number, currency: string): string {
  const amount = value.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'USD' ? `${amount} $` : `${amount} ${currency}`
}

export function formatPrice(value: number): string {
  if (Math.abs(value) >= 1000) return `${value.toLocaleString('ro-RO', { maximumFractionDigits: 0 })}$`
  if (Math.abs(value) >= 1) return `${value.toLocaleString('ro-RO', { maximumFractionDigits: 2 })}$`
  return `${value.toPrecision(4)}$`
}

export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
}

export function formatAge(minutes: number): string {
  if (minutes < 1) return 'acum câteva secunde'
  if (minutes < 60) return `acum ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `acum ${hours} h`
  return `acum ${Math.floor(hours / 24)} zile`
}

export function formatSeconds(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 120) return `${Math.round(sec)} s`
  if (sec < 7200) return `${Math.round(sec / 60)} min`
  return `${Math.round(sec / 3600)} h`
}

export function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

export function pnlClass(pct: number): string | undefined {
  if (pct > 0) return 'text-success-text'
  if (pct < 0) return 'text-destructive-text'
  return undefined
}
