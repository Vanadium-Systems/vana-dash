// Client Trading212 Public API (PLAN.md Track D — Wave 7) — DOAR live (broker.mode='live').
// Trading212 nu are testnet prin API, deci paper mode nu-l atinge deloc (ordine simulate local,
// vezi service.ts). Auth: header Authorization = cheia brută (fără prefix Bearer, per docs
// oficiale). Cheia NICIODATĂ în loguri/răspunsuri — apelantul primește doar date de portofoliu.
const BASE = 'https://live.trading212.com/api/v0'
const ALLOWED_HOST = 'live.trading212.com'
const FETCH_TIMEOUT_MS = 15_000

async function request<T>(
  path: string,
  apiKey: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  const url = new URL(BASE + path)
  if (url.hostname !== ALLOWED_HOST) throw new Error(`Domeniu nepermis: ${url.hostname}`)

  const res = await fetch(url, {
    method,
    headers: { Authorization: apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 429) throw new Error('Trading212 rate-limit (429) — încearcă mai târziu')
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Trading212 HTTP ${res.status}: ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export interface T212Position {
  ticker: string
  quantity: number
  averagePrice: number
  currentPrice: number
}

export async function getPositions(apiKey: string): Promise<T212Position[]> {
  const raw = await request<Array<{ ticker: string; quantity: number; averagePrice: number; currentPrice: number }>>(
    '/equity/portfolio',
    apiKey,
  )
  return raw.map((p) => ({ ticker: p.ticker, quantity: p.quantity, averagePrice: p.averagePrice, currentPrice: p.currentPrice }))
}

export interface T212Cash {
  free: number
  total: number
  invested: number
}

export async function getCash(apiKey: string): Promise<T212Cash> {
  const raw = await request<{ free: number; total: number; invested: number }>('/equity/account/cash', apiKey)
  return { free: raw.free, total: raw.total, invested: raw.invested }
}

export interface T212Order {
  id: number
  status: string
  ticker: string
  quantity: number
  filledQuantity: number | null
  fillPrice: number | null
}

export async function placeMarketOrder(apiKey: string, ticker: string, quantity: number): Promise<T212Order> {
  const raw = await request<{ id: number; status: string; ticker: string; quantity: number; filledQuantity?: number; fillPrice?: number }>(
    '/equity/orders/market',
    apiKey,
    'POST',
    { ticker, quantity },
  )
  return {
    id: raw.id,
    status: raw.status,
    ticker: raw.ticker,
    quantity: raw.quantity,
    filledQuantity: raw.filledQuantity ?? null,
    fillPrice: raw.fillPrice ?? null,
  }
}

export async function placeLimitOrder(apiKey: string, ticker: string, quantity: number, limitPrice: number): Promise<T212Order> {
  const raw = await request<{ id: number; status: string; ticker: string; quantity: number; filledQuantity?: number; fillPrice?: number }>(
    '/equity/orders/limit',
    apiKey,
    'POST',
    { ticker, quantity, limitPrice, timeValidity: 'GOOD_TILL_CANCEL' },
  )
  return {
    id: raw.id,
    status: raw.status,
    ticker: raw.ticker,
    quantity: raw.quantity,
    filledQuantity: raw.filledQuantity ?? null,
    fillPrice: raw.fillPrice ?? null,
  }
}
