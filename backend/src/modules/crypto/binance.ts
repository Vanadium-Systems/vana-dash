import { createHmac } from 'node:crypto'
import { tr } from '../../shared/lib/i18n.js'

// Client Binance REST (PLAN.md Contract D) — semnătură HMAC-SHA256 pe query string, header
// X-MBX-APIKEY. Produs = api.binance.com, testnet = testnet.binance.vision (dezvoltare fără
// riscuri). Cheile NICIODATĂ în loguri sau răspunsuri — apelantul primește doar date de piață.
const BASE_URLS: Record<'binance' | 'binance_testnet', string> = {
  binance: 'https://api.binance.com',
  binance_testnet: 'https://testnet.binance.vision',
}
const ALLOWED_HOSTS = new Set(['api.binance.com', 'testnet.binance.vision'])
const FETCH_TIMEOUT_MS = 15_000
const RECV_WINDOW_MS = 5000

export interface BinanceKeys {
  apiKey: string
  apiSecret: string
}

export function signQuery(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex')
}

async function request<T>(
  exchange: keyof typeof BASE_URLS,
  path: string,
  params: Record<string, string | number>,
  keys?: BinanceKeys,
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  // Concatenare directă — new URL(path, BASE) cu path absolut ar pierde /api/v3.
  const url = new URL(BASE_URLS[exchange] + path)
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(tr('errors.net.domainNotAllowed', { hostname: url.hostname }))

  if (keys) {
    params.timestamp = Date.now()
    params.recvWindow = RECV_WINDOW_MS
  }
  const search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string]))
  let headers: Record<string, string> = {}
  if (keys) {
    search.append('signature', signQuery(search.toString(), keys.apiSecret))
    headers = { 'X-MBX-APIKEY': keys.apiKey }
  }
  url.search = search.toString()

  const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { msg?: string } | null
    throw new Error(tr('errors.net.binanceHttp', { status: res.status, msg: body?.msg ?? res.statusText }))
  }
  return (await res.json()) as T
}

export async function tickerPrice(exchange: keyof typeof BASE_URLS, symbol: string): Promise<number | null> {
  const raw = await request<{ price: string }>(exchange, '/api/v3/ticker/price', { symbol })
  const price = Number(raw.price)
  return Number.isFinite(price) ? price : null
}

export interface BinanceBalance {
  asset: string
  free: number
  locked: number
}

export async function getAccountBalances(exchange: keyof typeof BASE_URLS, keys: BinanceKeys): Promise<BinanceBalance[]> {
  const raw = await request<{ balances: Array<{ asset: string; free: string; locked: string }> }>(
    exchange,
    '/api/v3/account',
    {},
    keys,
  )
  return raw.balances
    .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
    .filter((b) => b.free > 0 || b.locked > 0)
}

export interface BinanceTrade {
  symbol: string
  qty: number
  price: number
  quoteQty: number
  commission: number
  time: number
  isBuyer: boolean
}

export async function myTrades(exchange: keyof typeof BASE_URLS, keys: BinanceKeys, symbol: string, limit = 50): Promise<BinanceTrade[]> {
  const raw = await request<
    Array<{ symbol: string; qty: string; price: string; quoteQty: string; commission: string; time: number; isBuyer: boolean }>
  >(exchange, '/api/v3/myTrades', { symbol, limit }, keys)
  return raw.map((t) => ({
    symbol: t.symbol,
    qty: Number(t.qty),
    price: Number(t.price),
    quoteQty: Number(t.quoteQty),
    commission: Number(t.commission),
    time: t.time,
    isBuyer: t.isBuyer,
  }))
}

export interface PlaceOrderParams {
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'MARKET' | 'LIMIT'
  quantity: number
  price?: number
}

export async function placeOrder(
  exchange: keyof typeof BASE_URLS,
  keys: BinanceKeys,
  params: PlaceOrderParams,
): Promise<{ orderId: number; status: string; executedQty: string; cummulativeQuoteQty: string }> {
  const orderParams: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    quantity: params.quantity,
  }
  if (params.type === 'LIMIT') {
    orderParams.timeInForce = 'GTC'
    orderParams.price = params.price!
  }
  return request(exchange, '/api/v3/order', orderParams, keys, 'POST')
}
