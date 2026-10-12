import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { cryptoExchanges, cryptoPaperOrders, dashboardConfig, platforms, platformMetrics } from '../../shared/db/schema/index.js'
import { decryptApiKey, encryptApiKey } from '../../shared/lib/crypto.js'
import * as coingecko from './coingecko.js'
import type { MarketCoin } from './coingecko.js'
import * as binance from './binance.js'
import * as geckoterminal from './geckoterminal.js'
import type { DexPool } from './geckoterminal.js'
import { tr } from '../../shared/lib/i18n.js'

// Modulul Crypto (PLAN.md Contract D). Datele de piață vin din CoinGecko (cache în memorie —
// date externe, nu agregare DB), alertele reutilizează platform_metrics + sistemul existent de
// alerte prin metricile `crypto.<symbol>` / `crypto.dex.<pool>` scrise de jobs/crypto-price-sync.ts.

const WATCHLIST_KEY = 'crypto_watchlist'
const TRADING_ENABLED_KEY = 'crypto_trading_enabled'

export interface WatchEntry {
  kind: 'cex' | 'dex'
  id: string
  symbol: string
  name: string
  network?: string
  address?: string
  dex?: string
}

async function readConfigJson<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, key))
  return row ? (row.value as T) : null
}

async function writeConfigJson(key: string, value: unknown): Promise<void> {
  await db
    .insert(dashboardConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

export async function getWatchlist(): Promise<WatchEntry[]> {
  return (await readConfigJson<WatchEntry[]>(WATCHLIST_KEY)) ?? []
}

export async function addToWatchlist(entry: WatchEntry): Promise<WatchEntry[]> {
  const current = await getWatchlist()
  if (!current.some((e) => e.kind === entry.kind && e.id === entry.id)) current.push(entry)
  await writeConfigJson(WATCHLIST_KEY, current)
  return current
}

export async function removeFromWatchlist(kind: WatchEntry['kind'], id: string): Promise<WatchEntry[]> {
  const next = (await getWatchlist()).filter((e) => !(e.kind === kind && e.id === id))
  await writeConfigJson(WATCHLIST_KEY, next)
  return next
}

export interface WatchPrice {
  entry: WatchEntry
  priceUsd: number | null
  change24h: number | null
  // ultimele mostre din platform_metrics (24h, la rezoluția sync-ului) — sparkline-ul din UI
  sparkline: number[]
}

/** Prețuri curente + mini-serie pentru tot watchlist-ul — un singur apel pt. pagina Crypto,
 * cu cache-ul de 60s al clienților de mai jos. Sparkline-urile CEX vin din aceeași sursă ca
 * în lista de markets (/coins/markets pe ids — calitate identică, nu din mostrele locale de
 * 5 min care abia s-au acumulat), cele DEX din OHLCV GeckoTerminal. */
export async function getWatchlistPrices(): Promise<WatchPrice[]> {
  const entries = await getWatchlist()
  if (entries.length === 0) return []

  const cexEntries = entries.filter((e) => e.kind === 'cex')
  const dexEntries = entries.filter((e) => e.kind === 'dex')

  // CEX: un apel /coins/markets pe ids → preț + variație + sparkline 7z orar.
  const marketById = new Map<string, { priceUsd: number | null; change24h: number | null; sparkline: number[] }>()
  if (cexEntries.length > 0) {
    try {
      for (const coin of await coingecko.marketsByIds(cexEntries.map((e) => e.id))) {
        marketById.set(coin.id, { priceUsd: coin.priceUsd, change24h: coin.change24h, sparkline: coin.sparkline })
      }
    } catch (err) {
      console.error(`[crypto] watchlist markets/ids eșuat: ${String(err)}`)
    }
  }

  // DEX: preț curent din fetchPool + serie din OHLCV.
  const dexData = new Map<string, { priceUsd: number | null; change24h: number | null; sparkline: number[] }>()
  await Promise.all(
    dexEntries.map(async (entry) => {
      try {
        const [pool, spark] = await Promise.all([
          geckoterminal.fetchPool(entry.id),
          geckoterminal.poolSparkline(entry.id).catch(() => null),
        ])
        if (pool) {
          dexData.set(entry.id, {
            priceUsd: pool.priceUsd,
            change24h: pool.change24h,
            sparkline: spark ?? [],
          })
        }
      } catch {
        // pool lipsă/rețea jos — rămâne fără preț curent
      }
    }),
  )

  return entries.map((entry) => {
    if (entry.kind === 'cex') {
      const m = marketById.get(entry.id)
      return { entry, priceUsd: m?.priceUsd ?? null, change24h: m?.change24h ?? null, sparkline: m?.sparkline ?? [] }
    }
    const d = dexData.get(entry.id)
    return { entry, priceUsd: d?.priceUsd ?? null, change24h: d?.change24h ?? null, sparkline: d?.sparkline ?? [] }
  })
}

// ── Kill-switch + preferințe ──────────────────────────────────────────────────

export async function isTradingEnabled(): Promise<boolean> {
  return (await readConfigJson<boolean>(TRADING_ENABLED_KEY)) ?? false
}

export async function setTradingEnabled(enabled: boolean): Promise<boolean> {
  await writeConfigJson(TRADING_ENABLED_KEY, enabled)
  return enabled
}

// ── Platforma virtuală 'crypto' — părintele metricilor `crypto.*` din platform_metrics ──

let cryptoPlatformIdCache: string | null = null

/** Rând-ul platforms cu type='crypto' e sursa FK pt. metricile de preț — se asigură la primul
 * sync/rute apelate, nu la boot (DB-ul poate fi gol la prima pornire). */
export async function ensureCryptoPlatform(): Promise<string> {
  if (cryptoPlatformIdCache) return cryptoPlatformIdCache
  const [existing] = await db
    .select({ id: platforms.id })
    .from(platforms)
    .where(and(eq(platforms.type, 'crypto'), isNull(platforms.deletedAt)))
    .limit(1)
  if (existing) {
    cryptoPlatformIdCache = existing.id
    return existing.id
  }
  const [row] = await db
    .insert(platforms)
    .values({
      name: 'Crypto',
      type: 'crypto',
      apiUrl: 'https://api.coingecko.com',
      apiKeyEnc: encryptApiKey(''),
      syncCron: '*/5 * * * *',
      healthStatus: 'healthy',
    })
    .returning()
  cryptoPlatformIdCache = row!.id
  return row!.id
}

/** Scriu prețurile ca serie temporală standard (UPSERT pe unicul platform_metrics) — alertele,
 * sparkline-urile și graficele existente funcționează pe ele fără cod nou. */
export async function recordPriceMetrics(
  metrics: Array<{ metricKey: string; value: number; unit?: string; meta?: Record<string, unknown> }>,
): Promise<void> {
  if (metrics.length === 0) return
  const platformId = await ensureCryptoPlatform()
  const now = new Date()
  // recordedAt rotunjit la minut — upsert-ul per minut suprascrie prețul curent, fără rânduri noi
  // la fiecare sync (5 min × zeci coinuri ar crește tabela inutil).
  now.setSeconds(0, 0)
  // Un singur rând per metricKey — top-50 și simple/price pot acoperi aceeași monedă, iar
  // Postgres respinge "ON CONFLICT DO UPDATE ... affected row a second time" pe duplicate.
  const byKey = new Map(metrics.map((m) => [m.metricKey, m]))
  const rows = [...byKey.values()].map((m) => ({
    platformId,
    metricKey: m.metricKey,
    value: String(m.value),
    unit: m.unit ?? 'USD',
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

// ── Exchanges conectate ───────────────────────────────────────────────────────

export interface ExchangeStatus {
  exchange: 'binance' | 'binance_testnet'
  mode: 'paper' | 'live'
  enabled: boolean
  apiKeyMasked: string
  connectedAt: string
}

function maskKey(apiKeyEnc: string): string {
  try {
    const plain = decryptApiKey(apiKeyEnc)
    return plain.length <= 8 ? '****' : `****${plain.slice(-4)}`
  } catch {
    return '****'
  }
}

export async function listExchanges(): Promise<ExchangeStatus[]> {
  const rows = await db
    .select()
    .from(cryptoExchanges)
    .where(isNull(cryptoExchanges.deletedAt))
    .orderBy(desc(cryptoExchanges.createdAt))
  return rows.map((r) => ({
    exchange: r.exchange,
    mode: r.mode,
    enabled: r.enabled,
    apiKeyMasked: maskKey(r.apiKeyEnc),
    connectedAt: r.createdAt.toISOString(),
  }))
}

export async function connectExchange(input: {
  exchange: 'binance' | 'binance_testnet'
  apiKey: string
  apiSecret: string
  mode: 'paper' | 'live'
  enabled: boolean
}): Promise<void> {
  await db
    .insert(cryptoExchanges)
    .values({
      exchange: input.exchange,
      apiKeyEnc: encryptApiKey(input.apiKey),
      apiSecretEnc: encryptApiKey(input.apiSecret),
      mode: input.mode,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: cryptoExchanges.exchange,
      set: {
        apiKeyEnc: sql`excluded.api_key_enc`,
        apiSecretEnc: sql`excluded.api_secret_enc`,
        mode: sql`excluded.mode`,
        enabled: sql`excluded.enabled`,
        deletedAt: null,
        updatedAt: new Date(),
      },
    })
}

export async function disconnectExchange(exchange: 'binance' | 'binance_testnet'): Promise<void> {
  await db.update(cryptoExchanges).set({ deletedAt: new Date(), enabled: false }).where(eq(cryptoExchanges.exchange, exchange))
}

interface ExchangeRow {
  id: string
  exchange: 'binance' | 'binance_testnet'
  apiKeyEnc: string
  apiSecretEnc: string
  mode: 'paper' | 'live'
  enabled: boolean
}

async function getEnabledExchange(exchange: 'binance' | 'binance_testnet'): Promise<ExchangeRow | null> {
  const [row] = await db
    .select()
    .from(cryptoExchanges)
    .where(and(eq(cryptoExchanges.exchange, exchange), eq(cryptoExchanges.enabled, true), isNull(cryptoExchanges.deletedAt)))
    .limit(1)
  return row ?? null
}

function keysOf(row: ExchangeRow): binance.BinanceKeys {
  return { apiKey: decryptApiKey(row.apiKeyEnc), apiSecret: decryptApiKey(row.apiSecretEnc) }
}

// ── Ordine ────────────────────────────────────────────────────────────────────

export interface OrderPreview {
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

export async function previewOrder(input: {
  exchange: 'binance' | 'binance_testnet'
  symbol: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity: number
  limitPrice?: number
}): Promise<OrderPreview> {
  const row = await getEnabledExchange(input.exchange)
  if (!row) throw new Error(tr('errors.trading.exchangeNotConnected', { exchange: input.exchange }))
  const referencePrice = await binance.tickerPrice(input.exchange, input.symbol)
  const effective = input.type === 'limit' ? input.limitPrice! : referencePrice
  return {
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    quantity: input.quantity,
    limitPrice: input.limitPrice ?? null,
    referencePrice,
    estimatedQuoteValue: effective !== null ? Math.round(effective * input.quantity * 100) / 100 : null,
    mode: row.mode,
    tradingEnabled: await isTradingEnabled(),
  }
}

async function fillMarketPaperOrder(exchangeRow: ExchangeRow, orderId: string, symbol: string): Promise<number> {
  const price = await binance.tickerPrice(exchangeRow.exchange, symbol)
  if (price === null) throw new Error(tr('errors.trading.noLivePriceOn', { symbol, exchange: exchangeRow.exchange }))
  await db
    .update(cryptoPaperOrders)
    .set({ executedPrice: String(price), status: 'filled', executedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(cryptoPaperOrders.id, orderId), eq(cryptoPaperOrders.status, 'open')))
  return price
}

export async function placeOrder(input: {
  exchange: 'binance' | 'binance_testnet'
  symbol: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity: number
  limitPrice?: number
}): Promise<{ filled: boolean; paper: boolean; price: number | null }> {
  const row = await getEnabledExchange(input.exchange)
  if (!row) throw new Error(tr('errors.trading.exchangeNotConnected', { exchange: input.exchange }))

  if (row.mode === 'paper') {
    const [order] = await db
      .insert(cryptoPaperOrders)
      .values({
        exchangeId: row.id,
        symbol: input.symbol,
        side: input.side,
        orderType: input.type,
        quantity: String(input.quantity),
        limitPrice: input.limitPrice !== undefined ? String(input.limitPrice) : null,
      })
      .returning()
    if (input.type === 'market') {
      const price = await fillMarketPaperOrder(row, order!.id, input.symbol)
      return { filled: true, paper: true, price }
    }
    return { filled: false, paper: true, price: null }
  }

  // Live — kill-switch obligatoriu (fail-closed: lipsă config = blocat).
  if (!(await isTradingEnabled())) throw new Error(tr('errors.trading.liveOff'))
  const result = await binance.placeOrder(input.exchange, keysOf(row), {
    symbol: input.symbol,
    side: input.side.toUpperCase() as 'BUY' | 'SELL',
    type: input.type.toUpperCase() as 'MARKET' | 'LIMIT',
    quantity: input.quantity,
    price: input.limitPrice,
  })
  const price = Number(result.cummulativeQuoteQty) / Number(result.executedQty || '1')
  return { filled: result.status === 'FILLED', paper: false, price: Number.isFinite(price) ? price : null }
}

/** Limit paper orders care au fost trecute prin preț de la ultimul sync — rulate din
 * jobs/crypto-price-sync.ts. Buy se execută când prețul coboară ≤ limit, sell când urcă ≥ limit. */
export async function fillDueLimitPaperOrders(): Promise<number> {
  const open = await db
    .select({ order: cryptoPaperOrders, exchange: cryptoExchanges })
    .from(cryptoPaperOrders)
    .innerJoin(cryptoExchanges, eq(cryptoPaperOrders.exchangeId, cryptoExchanges.id))
    .where(and(isNull(cryptoPaperOrders.deletedAt), eq(cryptoPaperOrders.status, 'open')))

  let filled = 0
  for (const { order, exchange } of open) {
    try {
      if (order.limitPrice === null) continue
      const price = await binance.tickerPrice(exchange.exchange, order.symbol)
      if (price === null) continue
      const limit = Number(order.limitPrice)
      const crossed = order.side === 'buy' ? price <= limit : price >= limit
      if (!crossed) continue
      await db
        .update(cryptoPaperOrders)
        .set({ executedPrice: String(price), status: 'filled', executedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(cryptoPaperOrders.id, order.id), eq(cryptoPaperOrders.status, 'open')))
      filled++
    } catch (err) {
      console.error(`[crypto] fill limit ${order.symbol}: ${String(err)}`)
    }
  }
  return filled
}

export async function listRecentOrders(limit = 100) {  return db
    .select({
      id: cryptoPaperOrders.id,
      symbol: cryptoPaperOrders.symbol,
      side: cryptoPaperOrders.side,
      orderType: cryptoPaperOrders.orderType,
      quantity: cryptoPaperOrders.quantity,
      limitPrice: cryptoPaperOrders.limitPrice,
      executedPrice: cryptoPaperOrders.executedPrice,
      status: cryptoPaperOrders.status,
      executedAt: cryptoPaperOrders.executedAt,
      createdAt: cryptoPaperOrders.createdAt,
    })
    .from(cryptoPaperOrders)
    .where(isNull(cryptoPaperOrders.deletedAt))
    .orderBy(desc(cryptoPaperOrders.createdAt))
    .limit(limit)
}

export interface TradeRow {
  source: 'paper' | 'live'
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  quoteQty: number | null
  time: string
}

/** Istoric tranzacții: live = myTrades de pe Binance (per pereche), paper = ordinele fill-uite. */
export async function listTrades(exchangeName: 'binance' | 'binance_testnet', symbol?: string): Promise<TradeRow[]> {
  const row = await getEnabledExchange(exchangeName)
  if (!row) return []

  if (row.mode === 'live') {
    if (!symbol) throw new Error(tr('errors.trading.liveHistoryNeedsSymbol'))
    const trades = await binance.myTrades(exchangeName, keysOf(row), symbol, 50)
    return trades.map((t) => ({
      source: 'live',
      symbol,
      side: t.isBuyer ? 'buy' : 'sell',
      qty: t.qty,
      price: t.price,
      quoteQty: t.quoteQty,
      time: new Date(t.time).toISOString(),
    }))
  }

  const fills = await db
    .select()
    .from(cryptoPaperOrders)
    .where(
      and(
        isNull(cryptoPaperOrders.deletedAt),
        eq(cryptoPaperOrders.exchangeId, row.id),
        eq(cryptoPaperOrders.status, 'filled'),
        ...(symbol ? [eq(cryptoPaperOrders.symbol, symbol)] : []),
      ),
    )
    .orderBy(desc(cryptoPaperOrders.executedAt))
    .limit(100)

  return fills.map((o) => ({
    source: 'paper',
    symbol: o.symbol,
    side: o.side as 'buy' | 'sell',
    qty: Number(o.quantity),
    price: Number(o.executedPrice!),
    quoteQty: null,
    time: (o.executedAt ?? o.createdAt).toISOString(),
  }))
}

// ── Portofoliu ────────────────────────────────────────────────────────────────

export interface PortfolioPosition {
  source: 'paper' | 'live'
  asset: string
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

/** Metoda cost mediu pe ordine paper filled — pură, testată separat. */
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
      if (lot.qty < 1e-12) {
        lot.qty = 0
        lot.cost = 0
      }
    }
    bySymbol.set(f.symbol, lot)
  }
  return bySymbol
}

export async function getPortfolio(exchangeName: 'binance' | 'binance_testnet'): Promise<{ positions: PortfolioPosition[]; realizedPnlUsd: number }> {
  const row = await getEnabledExchange(exchangeName)
  if (!row) return { positions: [], realizedPnlUsd: 0 }

  const positions: PortfolioPosition[] = []

  if (row.mode === 'live') {
    // Balance-urile Binance sunt per asset (BTC, ETH, USDT...). Le prețuiesc pe perechea
    // <ASSET>USDT când există; USDT în sine = 1 USD, restul fără pereche rămân neevaluați.
    const balances = await binance.getAccountBalances(exchangeName, keysOf(row))
    for (const b of balances) {
      const qty = b.free + b.locked
      if (qty <= 0) continue
      let price: number | null = null
      try {
        price = b.asset === 'USDT' ? 1 : await binance.tickerPrice(exchangeName, `${b.asset}USDT`)
      } catch {
        price = null
      }
      positions.push({
        source: 'live',
        asset: b.asset,
        qty,
        avgCostUsd: null,
        priceUsd: price,
        valueUsd: price !== null ? price * qty : null,
        unrealizedPnlUsd: null,
      })
    }
    return { positions, realizedPnlUsd: 0 }
  }

  const fills = await db
    .select()
    .from(cryptoPaperOrders)
    .where(and(isNull(cryptoPaperOrders.deletedAt), eq(cryptoPaperOrders.exchangeId, row.id), eq(cryptoPaperOrders.status, 'filled')))

  const lots = aggregatePaperPositions(
    fills.map((o) => ({ symbol: o.symbol, side: o.side as 'buy' | 'sell', quantity: Number(o.quantity), executedPrice: Number(o.executedPrice!) })),
  )
  let realized = 0
  for (const [symbol, lot] of lots) {
    realized += lot.realizedPnl
    if (lot.qty <= 0) continue
    let price: number | null = null
    try {
      price = await binance.tickerPrice(exchangeName, symbol)
    } catch {
      price = null
    }
    const avgCost = lot.qty > 0 ? lot.cost / lot.qty : null
    positions.push({
      source: 'paper',
      asset: symbol.replace(/USDT$/, ''),
      qty: lot.qty,
      avgCostUsd: avgCost,
      priceUsd: price,
      valueUsd: price !== null ? price * lot.qty : null,
      unrealizedPnlUsd: price !== null && avgCost !== null ? (price - avgCost) * lot.qty : null,
    })
  }
  return { positions, realizedPnlUsd: realized }
}

// ── Re-exporturi pt. rute și joburi ───────────────────────────────────────────

export async function searchMarkets(query: string): Promise<{ coins: coingecko.SearchCoin[]; pools: DexPool[] }> {
  const [coins, pools] = await Promise.all([
    coingecko.searchCoins(query).catch(() => []),
    geckoterminal.searchPools(query).catch(() => [] as DexPool[]),
  ])
  return { coins, pools }
}

export async function listMarketsPage(
  page: number,
  category: string,
  perPage: 25 | 50 = 25,
): Promise<{ coins: MarketCoin[]; totalPages: number | null }> {
  return coingecko.listMarkets(page, category, perPage)
}

export async function getCoinDetails(id: string) {
  return coingecko.coinDetails(id)
}

export async function getCoinChart(id: string, days: 1 | 7 | 30 | 90 | 365) {
  return coingecko.marketChart(id, days)
}

export async function getCoinCandles(id: string, days: 1 | 7 | 30 | 90 | 365) {
  return coingecko.marketOhlc(id, days)
}
