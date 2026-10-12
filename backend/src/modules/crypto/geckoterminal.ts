// Client GeckoTerminal (DEX read-only, PLAN.md Contract D) — căutare + prețuri pt. pool-uri
// pe rețele on-chain (sol/eth/base/bsc...). Doar VIZUALIZARE și alerte — zero trading on-chain
// (DEX trading e amânat, TODO.md). Whitelist hostname identic cu coingecko.ts.
const BASE = 'https://api.geckoterminal.com/api/v1'
const ALLOWED_HOST = 'api.geckoterminal.com'
const FETCH_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60_000

export interface DexPool {
  // id GeckoTerminal `<network>_<pool_address>` — cheia pt. watchlist, alerte și metrici
  poolId: string
  network: string
  dex: string
  name: string
  address: string
  priceUsd: number | null
  change24h: number | null
}

interface RawPool {
  id: string
  attributes: {
    name: string
    address: string
    base_token_price_usd: string | null
    price_change_percentage?: { h24?: string } | null
    volume_usd?: { h24?: string }
    reserve_in_usd?: string
  }
  relationships?: { dex?: { data?: { id?: string } } }
}

const cache = new Map<string, { expiresAt: number; data: unknown; negativeUntil?: number }>()

async function fetchJson<T>(path: string): Promise<T> {
  // Concatenare directă — new URL(path, BASE) cu path absolut ar pierde /api/v1.
  const url = new URL(BASE + path)
  if (url.hostname !== ALLOWED_HOST) throw new Error(`Domeniu nepermis: ${url.hostname}`)

  const key = url.pathname + url.search
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.data as T

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`GeckoTerminal HTTP ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = (await res.json()) as T
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

function toPool(raw: RawPool): DexPool {
  const [network, address] = raw.id.split('_')
  return {
    poolId: raw.id,
    network: network ?? '',
    address: address ?? raw.attributes.address ?? '',
    dex: raw.relationships?.dex?.data?.id ?? '',
    name: raw.attributes.name,
    priceUsd: raw.attributes.base_token_price_usd ? Number(raw.attributes.base_token_price_usd) : null,
    change24h: raw.attributes.price_change_percentage?.h24 ? Number(raw.attributes.price_change_percentage.h24) : null,
  }
}

export async function searchPools(query: string): Promise<DexPool[]> {
  const raw = await fetchJson<{ data: RawPool[] }>(`/search/pools?query=${encodeURIComponent(query)}&page=1`)
  return (raw.data ?? []).slice(0, 12).map(toPool)
}

/** Prețul curent al unui pool favorit — folosit de crypto-price-sync pt. metricile `crypto.dex.*`. */
export async function fetchPool(poolId: string): Promise<DexPool | null> {
  const [network, ...rest] = poolId.split('_')
  const address = rest.join('_')
  if (!network || !address || /[^a-z0-9-]/i.test(network)) return null
  try {
    const raw = await fetchJson<{ data: RawPool }>(`/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(address)}`)
    return toPool(raw.data)
  } catch {
    return null
  }
}

/** Mini-serie de prețuri pt. sparkline-ul unui pool DEX favorit — lumânări orare de 4h
 * (42 × 4h ≈ 7 zile), close-uri only. null la orice eșec — UI-ul cade pe „—". */
export async function poolSparkline(poolId: string): Promise<number[] | null> {
  const [network, ...rest] = poolId.split('_')
  const address = rest.join('_')
  if (!network || !address || /[^a-z0-9-]/i.test(network)) return null
  try {
    const raw = await fetchJson<{ data?: { attributes?: { ohlcv_list?: Array<[number, string, string, string, string, number]> } } }>(
      `/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(address)}/ohlcv/hours?aggregate=4&limit=42`,
    )
    const list = raw.data?.attributes?.ohlcv_list ?? []
    const closes = list.map((c) => Number(c[4])).filter((n) => Number.isFinite(n))
    return closes.length >= 2 ? closes : null
  } catch {
    return null
  }
}
