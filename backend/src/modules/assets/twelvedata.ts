import { tr } from '../../shared/lib/i18n.js'
// Client Twelve Data public (PLAN.md Track D — Wave 7) — cotații pt. XAU/USD, XAG/USD (aur/
// argint) + fallback general. Cheia vine din DB (asset_price_providers, criptată). Tier
// gratuit: 8 req/min, 800/zi — cache 60s + apelat doar pt. favorite (set mic).
const BASE = 'https://api.twelvedata.com'
const ALLOWED_HOST = 'api.twelvedata.com'
const FETCH_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60_000

const cache = new Map<string, { expiresAt: number; data: unknown }>()

async function fetchJson<T>(path: string, apiKey: string): Promise<T> {
  const url = new URL(BASE + path)
  if (url.hostname !== ALLOWED_HOST) throw new Error(tr('errors.net.domainNotAllowed', { hostname: url.hostname }))
  url.searchParams.set('apikey', apiKey)

  // Cache pe cheia de request FĂRĂ apikey — o cheie nouă (schimbată din Setări) nu se serveşte
  // niciodată dintr-un rezultat vechi obținut cu alta.
  const cacheKey = url.pathname + url.search
  const hit = cache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now()) return hit.data as T

  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(tr('errors.net.twelveDataHttp', { status: res.status, detail: detail.slice(0, 200) }))
  }
  const data = (await res.json()) as { status?: string; message?: string } & T
  if (data.status === 'error') throw new Error(tr('errors.net.twelveDataError', { message: data.message ?? tr('errors.net.unknownError') }))
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

export interface Quote {
  priceUsd: number | null
  changePct: number | null
  previousClose: number | null
}

interface RawQuote {
  close?: string
  percent_change?: string
  previous_close?: string
}

export async function quote(apiKey: string, symbol: string): Promise<Quote> {
  const raw = await fetchJson<RawQuote>(`/quote?symbol=${encodeURIComponent(symbol)}`, apiKey)
  const close = raw.close !== undefined ? Number(raw.close) : null
  return {
    priceUsd: close !== null && Number.isFinite(close) ? close : null,
    changePct: raw.percent_change !== undefined ? Number(raw.percent_change) : null,
    previousClose: raw.previous_close !== undefined ? Number(raw.previous_close) : null,
  }
}

/** /time_series — serie zilnică pt. sparkline (metale, fallback acțiuni). */
export async function dailySeries(apiKey: string, symbol: string, outputsize: number): Promise<number[]> {
  const raw = await fetchJson<{ values?: Array<{ close: string }> }>(
    `/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}`,
    apiKey,
  )
  const values = raw.values ?? []
  // API-ul întoarce cel mai recent primul — sparkline-ul vrea ordine cronologică.
  return [...values].reverse().map((v) => Number(v.close)).filter((n) => Number.isFinite(n))
}

export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
}

/** /time_series cu OHLC complet — graficul paginii de detaliu (linie SAU candele, aceleași
 * bare). Finnhub blochează `/stock/candle` pe tier gratuit (403); Twelve Data nu, pt. acțiuni
 * ȘI metale — sursă unică pt. istoric, indiferent de categorie (quote-ul curent rămâne Finnhub
 * pt. acțiuni/ETF-uri). */
export async function timeSeriesBars(apiKey: string, symbol: string, interval: string, outputsize: number): Promise<Bar[]> {
  const raw = await fetchJson<{ values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }> }>(
    `/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}`,
    apiKey,
  )
  const values = raw.values ?? []
  return [...values]
    .reverse()
    .map((v) => ({ t: new Date(v.datetime.includes(' ') ? v.datetime.replace(' ', 'T') + 'Z' : v.datetime).getTime(), o: Number(v.open), h: Number(v.high), l: Number(v.low), c: Number(v.close) }))
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c))
}

export function clearCacheForTests(): void {
  cache.clear()
}
