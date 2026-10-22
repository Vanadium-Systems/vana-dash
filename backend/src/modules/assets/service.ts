import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { assetBrokers, assetPaperOrders, assetPriceProviders, dashboardConfig, platforms, platformMetrics } from '../../shared/db/schema/index.js'
import { decryptApiKey, encryptApiKey } from '../../shared/lib/crypto.js'
import * as finnhub from './finnhub.js'
import * as twelvedata from './twelvedata.js'
import * as trading212 from './trading212.js'
import { INDEX_CONSTITUENTS } from './index-constituents.js'
import { tr } from '../../shared/lib/i18n.js'

// Modulul Assets (PLAN.md Track D, Wave 7) — schelet identic modules/crypto/service.ts.
// Prețurile vin din Finnhub (acțiuni/ETF-uri) și Twelve Data (metale), alertele reutilizează
// platform_metrics + sistemul existent de alerte prin metricile `asset.<symbol>` scrise de
// jobs/assets-price-sync.ts.

const WATCHLIST_KEY = 'asset_watchlist'
const TRADING_ENABLED_KEY = 'asset_trading_enabled'

export type AssetCategory = 'stock' | 'etf' | 'metal'

export interface WatchEntry {
  category: AssetCategory
  symbol: string
  name: string
}

// Metalele nu au un endpoint de căutare — două perechi fixe Twelve Data, quick-add din UI.
export const METAL_OPTIONS: WatchEntry[] = [
  { category: 'metal', symbol: 'XAU/USD', name: 'Aur (XAU/USD)' },
  { category: 'metal', symbol: 'XAG/USD', name: 'Argint (XAG/USD)' },
]

async function readConfigJson<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, key))
  return row ? (row.value as T) : null
}

async function writeConfigJson(key: string, value: unknown): Promise<void> {
  await db
    .insert(dashboardConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

export async function getWatchlist(): Promise<WatchEntry[]> {
  return (await readConfigJson<WatchEntry[]>(WATCHLIST_KEY)) ?? []
}

export async function addToWatchlist(entry: WatchEntry): Promise<WatchEntry[]> {
  const current = await getWatchlist()
  if (!current.some((e) => e.category === entry.category && e.symbol === entry.symbol)) current.push(entry)
  await writeConfigJson(WATCHLIST_KEY, current)
  return current
}

export async function removeFromWatchlist(category: AssetCategory, symbol: string): Promise<WatchEntry[]> {
  const next = (await getWatchlist()).filter((e) => !(e.category === category && e.symbol === symbol))
  await writeConfigJson(WATCHLIST_KEY, next)
  return next
}

// ── Chei provideri de preț ───────────────────────────────────────────────────

function maskKey(apiKeyEnc: string): string {
  try {
    const plain = decryptApiKey(apiKeyEnc)
    return plain.length <= 8 ? '****' : `****${plain.slice(-4)}`
  } catch {
    return '****'
  }
}

export interface PriceProviderStatus {
  provider: 'finnhub' | 'twelvedata'
  enabled: boolean
  apiKeyMasked: string
}

export async function listPriceProviders(): Promise<PriceProviderStatus[]> {
  const rows = await db.select().from(assetPriceProviders).where(isNull(assetPriceProviders.deletedAt))
  return rows.map((r) => ({ provider: r.provider, enabled: r.enabled, apiKeyMasked: maskKey(r.apiKeyEnc) }))
}

export async function connectPriceProvider(input: { provider: 'finnhub' | 'twelvedata'; apiKey: string }): Promise<void> {
  await db
    .insert(assetPriceProviders)
    .values({ provider: input.provider, apiKeyEnc: encryptApiKey(input.apiKey), enabled: true })
    .onConflictDoUpdate({
      target: assetPriceProviders.provider,
      set: { apiKeyEnc: sql`excluded.api_key_enc`, enabled: true, deletedAt: null, updatedAt: new Date() },
    })
}

export async function disconnectPriceProvider(provider: 'finnhub' | 'twelvedata'): Promise<void> {
  await db.update(assetPriceProviders).set({ deletedAt: new Date(), enabled: false }).where(eq(assetPriceProviders.provider, provider))
}

async function getProviderKey(provider: 'finnhub' | 'twelvedata'): Promise<string | null> {
  const [row] = await db
    .select({ apiKeyEnc: assetPriceProviders.apiKeyEnc })
    .from(assetPriceProviders)
    .where(and(eq(assetPriceProviders.provider, provider), eq(assetPriceProviders.enabled, true), isNull(assetPriceProviders.deletedAt)))
    .limit(1)
  return row ? decryptApiKey(row.apiKeyEnc) : null
}

// ── Prețuri ───────────────────────────────────────────────────────────────────

export interface AssetPrice {
  priceUsd: number | null
  changePct: number | null
}

/** Cotația curentă pt. un simbol, rutată la provider-ul corect după categorie. `null` dacă
 * cheia provider-ului lipsește — apelantul degradează (best-effort), nu aruncă. */
export async function getPrice(category: AssetCategory, symbol: string): Promise<AssetPrice | null> {
  if (category === 'metal') {
    const key = await getProviderKey('twelvedata')
    if (!key) return null
    const q = await twelvedata.quote(key, symbol)
    return { priceUsd: q.priceUsd, changePct: q.changePct }
  }
  const key = await getProviderKey('finnhub')
  if (!key) return null
  const q = await finnhub.quote(key, symbol)
  return { priceUsd: q.priceUsd, changePct: q.changePct }
}

export interface WatchPrice {
  entry: WatchEntry
  priceUsd: number | null
  changePct: number | null
  sparkline: number[]
}

/** Prețuri + mini-serie pt. tot watchlist-ul (favoritele din pagina Assets). Fiecare eșec
 * individual degradează la preț/sparkline lipsă — un simbol jos nu blochează restul. */
export async function getWatchlistPrices(): Promise<WatchPrice[]> {
  const entries = await getWatchlist()
  if (entries.length === 0) return []

  const finnhubKey = await getProviderKey('finnhub')
  const twelvedataKey = await getProviderKey('twelvedata')

  return Promise.all(
    entries.map(async (entry) => {
      try {
        if (entry.category === 'metal') {
          if (!twelvedataKey) return { entry, priceUsd: null, changePct: null, sparkline: [] }
          const [q, series] = await Promise.all([
            twelvedata.quote(twelvedataKey, entry.symbol),
            twelvedata.dailySeries(twelvedataKey, entry.symbol, 30).catch(() => []),
          ])
          return { entry, priceUsd: q.priceUsd, changePct: q.changePct, sparkline: series }
        }
        if (!finnhubKey) return { entry, priceUsd: null, changePct: null, sparkline: [] }
        const [q, candles] = await Promise.all([
          finnhub.quote(finnhubKey, entry.symbol),
          finnhub.dailyCandles(finnhubKey, entry.symbol, 30).catch(() => []),
        ])
        return { entry, priceUsd: q.priceUsd, changePct: q.changePct, sparkline: candles }
      } catch (err) {
        console.error(`[assets] preț ${entry.symbol} eșuat: ${String(err)}`)
        return { entry, priceUsd: null, changePct: null, sparkline: [] }
      }
    }),
  )
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

/** Detalii pt. pagina unui simbol (cerință Stefan: „cum e pe Crypto"). Metalele n-au profil de
 * companie (Finnhub) — doar cotația Twelve Data. `null` pe orice câmp fără cheie/date, nu aruncă. */
export async function getAssetDetail(category: AssetCategory, symbol: string, fallbackName?: string): Promise<AssetDetail> {
  const base = { symbol, category }
  if (category === 'metal') {
    const key = await getProviderKey('twelvedata')
    const q = key ? await twelvedata.quote(key, symbol).catch(() => null) : null
    return {
      ...base,
      name: fallbackName ?? symbol,
      priceUsd: q?.priceUsd ?? null,
      change: null,
      changePct: q?.changePct ?? null,
      open: null,
      high: null,
      low: null,
      previousClose: q?.previousClose ?? null,
      exchange: null,
      industry: null,
      marketCapUsd: null,
      sharesOutstanding: null,
      ipoDate: null,
      logoUrl: null,
      websiteUrl: null,
    }
  }
  const key = await getProviderKey('finnhub')
  const [q, profile] = await Promise.all([
    key ? finnhub.quote(key, symbol).catch(() => null) : Promise.resolve(null),
    key ? finnhub.companyProfile(key, symbol).catch(() => null) : Promise.resolve(null),
  ])
  return {
    ...base,
    name: profile?.name ?? fallbackName ?? symbol,
    priceUsd: q?.priceUsd ?? null,
    change: q?.change ?? null,
    changePct: q?.changePct ?? null,
    open: q?.open ?? null,
    high: q?.high ?? null,
    low: q?.low ?? null,
    previousClose: q?.previousClose ?? null,
    exchange: profile?.exchange ?? null,
    industry: profile?.industry ?? null,
    marketCapUsd: profile?.marketCapUsd ?? null,
    sharesOutstanding: profile?.sharesOutstanding ?? null,
    ipoDate: profile?.ipo ?? null,
    logoUrl: profile?.logo ?? null,
    websiteUrl: profile?.websiteUrl ?? null,
  }
}

const CHART_RANGES: Record<1 | 7 | 30 | 90 | 365, { interval: string; outputsize: number }> = {
  1: { interval: '15min', outputsize: 96 },
  7: { interval: '1h', outputsize: 168 },
  30: { interval: '1day', outputsize: 30 },
  90: { interval: '1day', outputsize: 90 },
  365: { interval: '1week', outputsize: 52 },
}

/** Grafic istoric (linie SAU candele, aceleași bare) — Twelve Data pt. ambele categorii, NU
 * Finnhub (candelele lui sunt blocate pe tier gratuit, verificat live). Listă goală = fără
 * cheie/eroare provider, degradează grațios (UI arată "grafic indisponibil"). */
export async function getAssetChart(symbol: string, days: 1 | 7 | 30 | 90 | 365): Promise<twelvedata.Bar[]> {
  const key = await getProviderKey('twelvedata')
  if (!key) return []
  const range = CHART_RANGES[days]
  try {
    return await twelvedata.timeSeriesBars(key, symbol, range.interval, range.outputsize)
  } catch (err) {
    console.error(`[assets] chart ${symbol} eșuat: ${String(err)}`)
    return []
  }
}

export async function searchSymbols(query: string): Promise<finnhub.SearchResult[]> {
  const key = await getProviderKey('finnhub')
  if (!key) return []
  return finnhub.searchSymbols(key, query).catch(() => [])
}

export interface IndexQuote {
  symbol: string
  name: string
  priceUsd: number | null
  changePct: number | null
}

/** Listă „top" (Stefan, 2026-08-27): S&P 500 + Nasdaq 100, NU un ranking live după market cap
 * (ar cere un endpoint plătit) — doar o listă mare, cunoscută, paginată; preț LIVE cerut DOAR
 * pt. simbolurile paginii vizibile (Finnhub, cache 60s), la fel ca /coins/markets la crypto. */
export async function listIndexPage(page: number, perPage: 25 | 50, search?: string): Promise<{ items: IndexQuote[]; totalPages: number; priceKeyMissing: boolean }> {
  const needle = search?.trim().toLowerCase()
  const filtered = needle
    ? INDEX_CONSTITUENTS.filter((c) => c.symbol.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle))
    : INDEX_CONSTITUENTS
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageItems = filtered.slice((page - 1) * perPage, (page - 1) * perPage + perPage)

  const key = await getProviderKey('finnhub')
  const items = await Promise.all(
    pageItems.map(async (c): Promise<IndexQuote> => {
      if (!key) return { symbol: c.symbol, name: c.name, priceUsd: null, changePct: null }
      try {
        const q = await finnhub.quote(key, c.symbol)
        return { symbol: c.symbol, name: c.name, priceUsd: q.priceUsd, changePct: q.changePct }
      } catch {
        return { symbol: c.symbol, name: c.name, priceUsd: null, changePct: null }
      }
    }),
  )
  return { items, totalPages, priceKeyMissing: !key }
}

// ── Kill-switch ────────────────────────────────────────────────────────────────

export async function isTradingEnabled(): Promise<boolean> {
  return (await readConfigJson<boolean>(TRADING_ENABLED_KEY)) ?? false
}

export async function setTradingEnabled(enabled: boolean): Promise<boolean> {
  await writeConfigJson(TRADING_ENABLED_KEY, enabled)
  return enabled
}

// ── Platforma virtuală 'assets' — părintele metricilor `asset.*` din platform_metrics ─────

let assetsPlatformIdCache: string | null = null

export async function ensureAssetsPlatform(): Promise<string> {
  if (assetsPlatformIdCache) return assetsPlatformIdCache
  const [existing] = await db
    .select({ id: platforms.id })
    .from(platforms)
    .where(and(eq(platforms.type, 'assets'), isNull(platforms.deletedAt)))
    .limit(1)
  if (existing) {
    assetsPlatformIdCache = existing.id
    return existing.id
  }
  const [row] = await db
    .insert(platforms)
    .values({
      name: 'Assets',
      type: 'assets',
      apiUrl: 'https://finnhub.io',
      apiKeyEnc: encryptApiKey(''),
      syncCron: '*/15 * * * *',
      healthStatus: 'healthy',
    })
    .returning()
  assetsPlatformIdCache = row!.id
  return row!.id
}

function metricKeyFor(symbol: string): string {
  // '/' din simbolurile de metale (XAU/USD) nu e valid într-un metricKey navigabil din alerte.
  return `asset.${symbol.replace(/\//g, '')}`
}

export async function recordPriceMetrics(metrics: Array<{ symbol: string; value: number; meta?: Record<string, unknown> }>): Promise<void> {
  if (metrics.length === 0) return
  const platformId = await ensureAssetsPlatform()
  const now = new Date()
  now.setSeconds(0, 0)
  const byKey = new Map(metrics.map((m) => [metricKeyFor(m.symbol), m]))
  const rows = [...byKey.entries()].map(([metricKey, m]) => ({
    platformId,
    metricKey,
    value: String(m.value),
    unit: 'USD',
    recordedAt: now,
    meta: m.meta ?? {},
  }))
  await db
    .insert(platformMetrics)
    .values(rows)
    .onConflictDoUpdate({
      target: [platformMetrics.platformId, platformMetrics.metricKey, platformMetrics.recordedAt],
      set: { value: sql`EXCLUDED.value`, meta: sql`EXCLUDED.meta` },
    })
}

// ── Broker (Trading212) ────────────────────────────────────────────────────────

export interface BrokerStatus {
  broker: 'trading212'
  mode: 'paper' | 'live'
  enabled: boolean
  apiKeyMasked: string
  connectedAt: string
}

export async function listBrokers(): Promise<BrokerStatus[]> {
  const rows = await db.select().from(assetBrokers).where(isNull(assetBrokers.deletedAt)).orderBy(desc(assetBrokers.createdAt))
  return rows.map((r) => ({ broker: r.broker, mode: r.mode, enabled: r.enabled, apiKeyMasked: maskKey(r.apiKeyEnc), connectedAt: r.createdAt.toISOString() }))
}

export async function connectBroker(input: { broker: 'trading212'; apiKey?: string; mode: 'paper' | 'live'; enabled: boolean }): Promise<void> {
  // Live cere cheie reală (validat deja de ConnectBrokerBodySchema); paper poate rămâne fără —
  // placeMarketOrder/placeLimitOrder n-o citesc niciodată cât timp mode==='paper'.
  await db
    .insert(assetBrokers)
    .values({ broker: input.broker, apiKeyEnc: encryptApiKey(input.apiKey ?? ''), mode: input.mode, enabled: input.enabled })
    .onConflictDoUpdate({
      target: assetBrokers.broker,
      set: { apiKeyEnc: sql`excluded.api_key_enc`, mode: sql`excluded.mode`, enabled: sql`excluded.enabled`, deletedAt: null, updatedAt: new Date() },
    })
}

export async function disconnectBroker(broker: 'trading212'): Promise<void> {
  await db.update(assetBrokers).set({ deletedAt: new Date(), enabled: false }).where(eq(assetBrokers.broker, broker))
}

interface BrokerRow {
  id: string
  broker: 'trading212'
  apiKeyEnc: string
  mode: 'paper' | 'live'
  enabled: boolean
}

async function getEnabledBroker(broker: 'trading212'): Promise<BrokerRow | null> {
  const [row] = await db
    .select()
    .from(assetBrokers)
    .where(and(eq(assetBrokers.broker, broker), eq(assetBrokers.enabled, true), isNull(assetBrokers.deletedAt)))
    .limit(1)
  return row ?? null
}

// ── Ordine ────────────────────────────────────────────────────────────────────
// Preview + paper folosesc `symbol` ca simbol Finnhub/Twelve Data (ex: AAPL, XAU/USD) — sursa
// de preț de referință. Live trimite `symbol` DIRECT la Trading212 ca ticker (ex: AAPL_US_EQ,
// vezi aplicația T212) — namespace diferit, la fel ca la crypto (id CoinGecko vs. pereche
// Binance); nu există o mapare automată sigură între cele două fără riscul unui ordin greșit.

export interface OrderPreview {
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

async function referencePriceFor(symbol: string): Promise<number | null> {
  // Categoria exactă nu contează pt. lookup — încercăm Finnhub, apoi Twelve Data (metale au '/').
  if (symbol.includes('/')) {
    const key = await getProviderKey('twelvedata')
    return key ? (await twelvedata.quote(key, symbol)).priceUsd : null
  }
  const key = await getProviderKey('finnhub')
  return key ? (await finnhub.quote(key, symbol)).priceUsd : null
}

export async function previewOrder(input: {
  broker: 'trading212'
  symbol: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity: number
  limitPrice?: number
}): Promise<OrderPreview> {
  const row = await getEnabledBroker(input.broker)
  if (!row) throw new Error(tr('errors.trading.brokerNotConnected', { broker: input.broker }))
  const referencePrice = row.mode === 'live' ? null : await referencePriceFor(input.symbol)
  const effective = input.type === 'limit' ? input.limitPrice! : referencePrice
  return {
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    quantity: input.quantity,
    limitPrice: input.limitPrice ?? null,
    referencePrice,
    estimatedValue: effective !== null ? Math.round(effective * input.quantity * 100) / 100 : null,
    mode: row.mode,
    tradingEnabled: await isTradingEnabled(),
  }
}

async function fillMarketPaperOrder(orderId: string, symbol: string): Promise<number> {
  const price = await referencePriceFor(symbol)
  if (price === null) throw new Error(tr('errors.trading.noLivePrice', { symbol }))
  await db
    .update(assetPaperOrders)
    .set({ executedPrice: String(price), status: 'filled', executedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(assetPaperOrders.id, orderId), eq(assetPaperOrders.status, 'open')))
  return price
}

export async function placeOrder(input: {
  broker: 'trading212'
  symbol: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity: number
  limitPrice?: number
}): Promise<{ filled: boolean; paper: boolean; price: number | null }> {
  const row = await getEnabledBroker(input.broker)
  if (!row) throw new Error(tr('errors.trading.brokerNotConnected', { broker: input.broker }))

  if (row.mode === 'paper') {
    const [order] = await db
      .insert(assetPaperOrders)
      .values({
        brokerId: row.id,
        symbol: input.symbol,
        side: input.side,
        orderType: input.type,
        quantity: String(input.quantity),
        limitPrice: input.limitPrice !== undefined ? String(input.limitPrice) : null,
      })
      .returning()
    if (input.type === 'market') {
      const price = await fillMarketPaperOrder(order!.id, input.symbol)
      return { filled: true, paper: true, price }
    }
    return { filled: false, paper: true, price: null }
  }

  // Live — kill-switch obligatoriu (fail-closed: lipsă config = blocat).
  if (!(await isTradingEnabled())) throw new Error(tr('errors.trading.liveOff'))
  const apiKey = decryptApiKey(row.apiKeyEnc)
  const result =
    input.type === 'market'
      ? await trading212.placeMarketOrder(apiKey, input.symbol, input.side === 'buy' ? input.quantity : -input.quantity)
      : await trading212.placeLimitOrder(apiKey, input.symbol, input.side === 'buy' ? input.quantity : -input.quantity, input.limitPrice!)
  return { filled: result.status === 'FILLED', paper: false, price: result.fillPrice }
}

/** Limit paper orders trecute prin preț de la ultimul sync — rulate din jobs/assets-price-sync.ts. */
export async function fillDueLimitPaperOrders(): Promise<number> {
  const open = await db.select().from(assetPaperOrders).where(and(isNull(assetPaperOrders.deletedAt), eq(assetPaperOrders.status, 'open')))

  let filled = 0
  for (const order of open) {
    try {
      if (order.limitPrice === null) continue
      const price = await referencePriceFor(order.symbol)
      if (price === null) continue
      const limit = Number(order.limitPrice)
      const crossed = order.side === 'buy' ? price <= limit : price >= limit
      if (!crossed) continue
      await db
        .update(assetPaperOrders)
        .set({ executedPrice: String(price), status: 'filled', executedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(assetPaperOrders.id, order.id), eq(assetPaperOrders.status, 'open')))
      filled++
    } catch (err) {
      console.error(`[assets] fill limit ${order.symbol}: ${String(err)}`)
    }
  }
  return filled
}

export async function listRecentOrders(limit = 100) {
  return db
    .select({
      id: assetPaperOrders.id,
      symbol: assetPaperOrders.symbol,
      side: assetPaperOrders.side,
      orderType: assetPaperOrders.orderType,
      quantity: assetPaperOrders.quantity,
      limitPrice: assetPaperOrders.limitPrice,
      executedPrice: assetPaperOrders.executedPrice,
      status: assetPaperOrders.status,
      executedAt: assetPaperOrders.executedAt,
      createdAt: assetPaperOrders.createdAt,
    })
    .from(assetPaperOrders)
    .where(isNull(assetPaperOrders.deletedAt))
    .orderBy(desc(assetPaperOrders.createdAt))
    .limit(limit)
}

// ── Portofoliu ────────────────────────────────────────────────────────────────

export interface PortfolioPosition {
  source: 'paper' | 'live'
  symbol: string
  qty: number
  avgCostUsd: number | null
  priceUsd: number | null
  valueUsd: number | null
  unrealizedPnlUsd: number | null
}

interface PaperLotAccumulator {
  qty: number
  cost: number
  realizedPnl: number
}

/** Metoda cost mediu pe ordine paper filled — identică algoritmic cu
 * modules/crypto/service.ts:aggregatePaperPositions (module izolate, fără cross-import). */
export function aggregatePaperPositions(
  fills: Array<{ symbol: string; side: 'buy' | 'sell'; quantity: number; executedPrice: number }>,
): Map<string, PaperLotAccumulator> {
  const bySymbol = new Map<string, PaperLotAccumulator>()
  for (const f of fills) {
    const lot = bySymbol.get(f.symbol) ?? { qty: 0, cost: 0, realizedPnl: 0 }
    if (f.side === 'buy') {
      lot.qty += f.quantity
      lot.cost += f.quantity * f.executedPrice
    } else {
      const avgCost = lot.qty > 0 ? lot.cost / lot.qty : 0
      const soldQty = Math.min(f.quantity, lot.qty)
      lot.realizedPnl += soldQty * (f.executedPrice - avgCost)
      lot.qty -= f.quantity
      lot.cost -= soldQty * avgCost
      if (lot.qty < 1e-9) {
        lot.qty = 0
        lot.cost = 0
      }
    }
    bySymbol.set(f.symbol, lot)
  }
  return bySymbol
}

export async function getPortfolio(brokerName: 'trading212'): Promise<{ positions: PortfolioPosition[]; realizedPnlUsd: number }> {
  const row = await getEnabledBroker(brokerName)
  if (!row) return { positions: [], realizedPnlUsd: 0 }

  if (row.mode === 'live') {
    const apiKey = decryptApiKey(row.apiKeyEnc)
    const raw = await trading212.getPositions(apiKey)
    return {
      positions: raw.map((p) => ({
        source: 'live',
        symbol: p.ticker,
        qty: p.quantity,
        avgCostUsd: p.averagePrice,
        priceUsd: p.currentPrice,
        valueUsd: p.currentPrice * p.quantity,
        unrealizedPnlUsd: (p.currentPrice - p.averagePrice) * p.quantity,
      })),
      realizedPnlUsd: 0,
    }
  }

  const fills = await db
    .select()
    .from(assetPaperOrders)
    .where(and(isNull(assetPaperOrders.deletedAt), eq(assetPaperOrders.brokerId, row.id), eq(assetPaperOrders.status, 'filled')))

  const lots = aggregatePaperPositions(
    fills.map((o) => ({ symbol: o.symbol, side: o.side as 'buy' | 'sell', quantity: Number(o.quantity), executedPrice: Number(o.executedPrice!) })),
  )
  let realized = 0
  const positions: PortfolioPosition[] = []
  for (const [symbol, lot] of lots) {
    realized += lot.realizedPnl
    if (lot.qty <= 0) continue
    let price: number | null = null
    try {
      price = await referencePriceFor(symbol)
    } catch {
      price = null
    }
    const avgCost = lot.qty > 0 ? lot.cost / lot.qty : null
    positions.push({
      source: 'paper',
      symbol,
      qty: lot.qty,
      avgCostUsd: avgCost,
      priceUsd: price,
      valueUsd: price !== null ? price * lot.qty : null,
      unrealizedPnlUsd: price !== null && avgCost !== null ? (price - avgCost) * lot.qty : null,
    })
  }
  return { positions, realizedPnlUsd: realized }
}
