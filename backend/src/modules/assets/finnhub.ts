import { tr } from '../../shared/lib/i18n.js'
// Client Finnhub public (PLAN.md Track D — Wave 7) — cotații + căutare pt. acțiuni/ETF-uri.
// Cheia vine din DB (asset_price_providers, criptată), niciodată logată. Hostname whitelist
// (nu input de la user), cache 60s — pattern identic modules/crypto/coingecko.ts.
const BASE = 'https://finnhub.io/api/v1'
const ALLOWED_HOST = 'finnhub.io'
const FETCH_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60_000

const cache = new Map<string, { expiresAt: number; data: unknown }>()

async function fetchJson<T>(path: string, apiKey: string, cacheable = true): Promise<T> {
  const url = new URL(BASE + path)
  if (url.hostname !== ALLOWED_HOST) throw new Error(tr('errors.net.domainNotAllowed', { hostname: url.hostname }))
  url.searchParams.set('token', apiKey)

  const cacheKey = url.pathname + url.search
  if (cacheable) {
    const hit = cache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) return hit.data as T
  }

  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (res.status === 429) throw new Error(tr('errors.net.finnhubRateLimit'))
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(tr('errors.net.finnhubHttp', { status: res.status, detail: detail.slice(0, 200) }))
  }
  const data = (await res.json()) as T
  if (cacheable) cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

export interface Quote {
  priceUsd: number | null
  change: number | null
  changePct: number | null
  open: number | null
  high: number | null
  low: number | null
  previousClose: number | null
}

interface RawQuote {
  c: number
  d: number | null
  dp: number | null
  o: number
  h: number
  l: number
  pc: number
}

/** /quote — cotația curentă (delay-at ~15min pe tier gratuit, suficient pt. urmărire, nu HFT). */
export async function quote(apiKey: string, symbol: string): Promise<Quote> {
  const raw = await fetchJson<RawQuote>(`/quote?symbol=${encodeURIComponent(symbol)}`, apiKey)
  return {
    priceUsd: raw.c > 0 ? raw.c : null,
    change: raw.d,
    changePct: raw.dp,
    open: raw.o > 0 ? raw.o : null,
    high: raw.h > 0 ? raw.h : null,
    low: raw.l > 0 ? raw.l : null,
    previousClose: raw.pc > 0 ? raw.pc : null,
  }
}

export interface SearchResult {
  symbol: string
  description: string
  type: string
}

/** /search — căutare simbol (acțiuni + ETF-uri; rezultatele fără type util sunt filtrate).
 * Necache-uită — rezultatele depind de textul complet tastat, cache-ul n-ar ajuta. */
export async function searchSymbols(apiKey: string, query: string): Promise<SearchResult[]> {
  const raw = await fetchJson<{ result: Array<{ symbol: string; description: string; type: string }> }>(
    `/search?q=${encodeURIComponent(query)}`,
    apiKey,
    false,
  )
  return (raw.result ?? [])
    .filter((r) => /^[A-Z][A-Z0-9.]{0,9}$/.test(r.symbol))
    .slice(0, 20)
    .map((r) => ({ symbol: r.symbol, description: r.description, type: r.type }))
}

/** /stock/candle — istoric zilnic pt. sparkline. Tier-ul gratuit poate respinge granularități
 * fine; eșecul se propagă către apelant, care degradează la sparkline gol (best-effort). */
export async function dailyCandles(apiKey: string, symbol: string, days: number): Promise<number[]> {
  const to = Math.floor(Date.now() / 1000)
  const from = to - days * 86400
  const raw = await fetchJson<{ s: string; c?: number[] }>(
    `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}`,
    apiKey,
  )
  if (raw.s !== 'ok' || !raw.c) return []
  return raw.c
}

export interface CompanyProfile {
  name: string | null
  exchange: string | null
  industry: string | null
  marketCapUsd: number | null
  sharesOutstanding: number | null
  ipo: string | null
  logo: string | null
  websiteUrl: string | null
}

/** /stock/profile2 — profil companie (doar acțiuni/ETF-uri cu profil corporate; metalele nu
 * au echivalent). Gratuit pe tier-ul free (spre deosebire de candele istorice). */
export async function companyProfile(apiKey: string, symbol: string): Promise<CompanyProfile | null> {
  const raw = await fetchJson<{
    name?: string
    exchange?: string
    finnhubIndustry?: string
    marketCapitalization?: number
    shareOutstanding?: number
    ipo?: string
    logo?: string
    weburl?: string
  }>(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`, apiKey)
  if (!raw.name) return null
  return {
    name: raw.name,
    exchange: raw.exchange ?? null,
    industry: raw.finnhubIndustry ?? null,
    // marketCapitalization vine în milioane USD.
    marketCapUsd: raw.marketCapitalization != null ? raw.marketCapitalization * 1_000_000 : null,
    sharesOutstanding: raw.shareOutstanding != null ? raw.shareOutstanding * 1_000_000 : null,
    ipo: raw.ipo ?? null,
    logo: raw.logo ?? null,
    websiteUrl: raw.weburl ?? null,
  }
}

export function clearCacheForTests(): void {
  cache.clear()
}
