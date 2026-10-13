import { tr } from '../../shared/lib/i18n.js'
// Client CoinGecko public (fără cheie, PLAN.md Contract D). Singurele URL-uri apelate sunt
// constantele de mai jos — hostname-ul e validat defensiv la fiecare request (whitelist,
// nu input de la user), pattern-ul cerut de PLAN.md pt. SSRF.
const BASE = 'https://api.coingecko.com/api/v3'
const ALLOWED_HOST = 'api.coingecko.com'
const FETCH_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60_000

export interface MarketCoin {
  id: string
  symbol: string
  name: string
  priceUsd: number | null
  change24h: number | null
  marketCapUsd: number | null
  // Ultimele ~168 puncte orare — sparkline-ul din UI, inclus în răspunsul /coins/markets.
  sparkline: number[]
}

interface RawCoinMarket {
  id: string
  symbol: string
  name: string
  current_price: number | null
  price_change_percentage_24h: number | null
  market_cap: number | null
  sparkline_in_7d?: { price: number[] } | null
}

const cache = new Map<string, { expiresAt: number; data: unknown }>()

async function fetchJson<T>(path: string): Promise<T> {
  // Concatenare directă, nu new URL(path, BASE) — path-urile pornesc cu '/' și ar rescrie
  // întregul path al base-ului, pierzând /api/v3.
  const url = new URL(BASE + path)
  if (url.hostname !== ALLOWED_HOST) throw new Error(tr('errors.net.domainNotAllowed', { hostname: url.hostname }))

  const hit = cache.get(url.pathname + url.search)
  if (hit && hit.expiresAt > Date.now()) return hit.data as T

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 429) throw new Error(tr('errors.net.coingeckoRateLimit'))
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(tr('errors.net.coingeckoHttp', { status: res.status, detail: detail.slice(0, 200) }))
  }
  const data = (await res.json()) as T
  cache.set(url.pathname + url.search, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

function toMarketCoin(raw: RawCoinMarket): MarketCoin {
  return {
    id: raw.id,
    symbol: raw.symbol.toUpperCase(),
    name: raw.name,
    priceUsd: raw.current_price,
    change24h: raw.price_change_percentage_24h,
    marketCapUsd: raw.market_cap,
    // Downsample 7z orar → ~56 puncte la 3h, suficient pentru un sparkline de 120px.
    sparkline: (raw.sparkline_in_7d?.price ?? []).filter((_, i) => i % 3 === 0),
  }
}

/** Pagină din topul CoinGecko ordonat după market cap. category='all' → fără filtru;
 * 'gainers' = primele 250 sortate desc pe variația 24h (endpoint-ul dedicat
 * /coins/top-gainers-losers cere cheie plătită — cercetat live 2026-08-26); restul trec ca
 * `category` (ex: 'meme-token' pt. Memecoins, id verificat în categories/list).
 * perPage: 25 (default UI) sau 50 — Stefan vrea listă densă, nu 250 rânduri. */
export async function listMarkets(
  page: number,
  category: string,
  perPage: 25 | 50 = 25,
): Promise<{ coins: MarketCoin[]; totalPages: number | null }> {
  if (category === 'gainers') {
    const raw = await fetchJson<RawCoinMarket[]>(
      `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=24h`,
    )
    const sorted = [...(Array.isArray(raw) ? raw : [])]
      .filter((c) => c.price_change_percentage_24h != null)
      .sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0))
      .slice(0, 50)
    return { coins: sorted.map(toMarketCoin), totalPages: 1 }
  }
  const catParam = category === 'all' ? '' : `&category=${encodeURIComponent(category)}`
  const raw = await fetchJson<RawCoinMarket[]>(
    `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=true&price_change_percentage=24h${catParam}`,
  )
  return { coins: Array.isArray(raw) ? raw.map(toMarketCoin) : [], totalPages: null }
}

/** Coinuri exacte după id (favoritele) — un singur apel, cu aceeași sparkline 7z ca în listă. */
export async function marketsByIds(ids: string[]): Promise<MarketCoin[]> {
  if (ids.length === 0) return []
  // /coins/markets acceptă până la ~250 ids pe apel — chunk-uri de 100.
  const out: MarketCoin[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map((id) => encodeURIComponent(id)).join(',')
    const raw = await fetchJson<RawCoinMarket[]>(
      `/coins/markets?vs_currency=usd&ids=${chunk}&sparkline=true&price_change_percentage=24h`,
    )
    out.push(...(Array.isArray(raw) ? raw.map(toMarketCoin) : []))
  }
  return out
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

interface RawCoinFull {
  id: string
  symbol: string
  name: string
  image: { large?: string }
  market_cap_rank: number | null
  market_data?: {
    current_price?: Record<string, number>
    price_change_percentage_24h?: number
    price_change_percentage_7d?: number
    price_change_percentage_30d?: number
    market_cap?: Record<string, number>
    total_volume?: Record<string, number>
    circulating_supply?: number
    total_supply?: number | null
    max_supply?: number | null
    ath?: Record<string, number>
    ath_change_percentage?: Record<string, number>
    ath_date?: Record<string, string>
    atl?: Record<string, number>
    atl_change_percentage?: Record<string, number>
    atl_date?: Record<string, string>
  }
  description?: { en?: string }
}

/** Detalii complete pt. pagina monedei — /coins/{id} cu tickers/community/developer oprite. */
export async function coinDetails(id: string): Promise<CoinDetails | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return null
  const raw = await fetchJson<RawCoinFull>(
    `/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
  )
  const md = raw.market_data ?? {}
  return {
    id: raw.id,
    symbol: (raw.symbol ?? '').toUpperCase(),
    name: raw.name,
    image: raw.image?.large ?? '',
    rank: raw.market_cap_rank,
    priceUsd: md.current_price?.usd ?? null,
    change24h: md.price_change_percentage_24h ?? null,
    change7d: md.price_change_percentage_7d ?? null,
    change30d: md.price_change_percentage_30d ?? null,
    marketCapUsd: md.market_cap?.usd ?? null,
    volume24hUsd: md.total_volume?.usd ?? null,
    circulatingSupply: md.circulating_supply ?? null,
    totalSupply: md.total_supply ?? null,
    maxSupply: md.max_supply ?? null,
    athUsd: md.ath?.usd ?? null,
    athChangePct: md.ath_change_percentage?.usd ?? null,
    athDate: md.ath_date?.usd ?? null,
    atlUsd: md.atl?.usd ?? null,
    atlChangePct: md.atl_change_percentage?.usd ?? null,
    atlDate: md.atl_date?.usd ?? null,
    description: raw.description?.en ? raw.description.en.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').slice(0, 1200) : null,
  }
}

/** Seria de preț pt. graficul paginii monedei — downsample la max ~160 puncte pt. randare fluidă. */
export async function marketChart(id: string, days: 1 | 7 | 30 | 90 | 365): Promise<Array<{ t: number; p: number }>> {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return []
  const raw = await fetchJson<{ prices: Array<[number, number]> }>(
    `/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`,
  )
  const prices = raw.prices ?? []
  const target = 160
  const step = Math.max(1, Math.ceil(prices.length / target))
  return prices.filter((_, i) => i % step === 0).map(([t, p]) => ({ t, p }))
}

/** Candele OHLC pt. modul „candele" din grafic — /coins/{id}/ohlc (granularitate aleasă
 * automat de CoinGecko: 30 min pe 1 zi, 4 zile peste 90 de zile). */
export async function marketOhlc(
  id: string,
  days: 1 | 7 | 30 | 90 | 365,
): Promise<Array<{ t: number; o: number; h: number; l: number; c: number }>> {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return []
  const raw = await fetchJson<Array<[number, number, number, number, number]>>(
    `/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`,
  )
  const target = 160
  const rows = (raw ?? []).map(([t, o, h, l, c]) => ({ t, o, h, l, c }))
  const step = Math.max(1, Math.ceil(rows.length / target))
  return rows.filter((_, i) => i % step === 0)
}

export async function simplePrice(ids: string[]): Promise<Record<string, { usd: number; usd_24h_change?: number }>> {
  if (ids.length === 0) return {}
  const query = ids.map((id) => encodeURIComponent(id)).join(',')
  return fetchJson(`/simple/price?ids=${query}&vs_currencies=usd&include_24hr_change=true`)
}

export interface SearchCoin {
  id: string
  symbol: string
  name: string
  thumb: string
}

export async function searchCoins(query: string): Promise<SearchCoin[]> {
  const raw = await fetchJson<{ coins: Array<{ id: string; symbol: string; name: string; thumb: string; market_cap_rank: number | null }> }>(
    `/search?query=${encodeURIComponent(query)}`,
  )
  return raw.coins.slice(0, 20).map((c) => ({ id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, thumb: c.thumb }))
}

// Folosit de teste ca să nu lovească rețeaua.
export function clearCacheForTests(): void {
  cache.clear()
}
