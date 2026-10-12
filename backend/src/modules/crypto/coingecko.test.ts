/**
 * Client CoinGecko — cache în memorie (60s) și validare hostname (SSRF), cu fetch stub-uit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCacheForTests, listMarkets } from './coingecko.js'

const fetchMock = vi.fn()

beforeEach(() => {
  clearCacheForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

describe('listMarkets', () => {
  it('apelează CoinGecko pe pagina cerută și normalizează răspunsul', async () => {
    fetchMock.mockResolvedValue(
      okResponse([
        {
          id: 'bitcoin',
          symbol: 'btc',
          name: 'Bitcoin',
          current_price: 65000,
          price_change_percentage_24h: -1.2,
          market_cap: 1_280_000_000_000,
          sparkline_in_7d: { price: [1, 2, 3, 4, 5, 6] },
        },
      ]),
    )
    const { coins } = await listMarkets(1, 'all')
    expect(coins[0]).toMatchObject({ id: 'bitcoin', symbol: 'BTC', priceUsd: 65000 })
    expect(fetchMock.mock.calls[0]?.[0]).toBeInstanceOf(URL)
    expect((fetchMock.mock.calls[0]?.[0] as URL).hostname).toBe('api.coingecko.com')
  })

  it('cache-uiește 60s — al doilea apel identic nu lovește rețeaua', async () => {
    fetchMock.mockResolvedValue(okResponse([]))
    await listMarkets(1, 'all')
    await listMarkets(1, 'all')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pagini diferite = cache keys diferite', async () => {
    fetchMock.mockResolvedValue(okResponse([]))
    await listMarkets(1, 'all')
    await listMarkets(2, 'all')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('category=gainers sortează desc pe variația 24h din topul standard', async () => {
    fetchMock.mockResolvedValue(
      okResponse([
        { id: 'a', symbol: 'a', name: 'A', current_price: 1, price_change_percentage_24h: -2, market_cap: 10, sparkline_in_7d: { price: [] } },
        { id: 'b', symbol: 'b', name: 'B', current_price: 1, price_change_percentage_24h: 5, market_cap: 20, sparkline_in_7d: { price: [] } },
      ]),
    )
    const { coins, totalPages } = await listMarkets(1, 'gainers')
    expect(coins.map((c) => c.id)).toEqual(['b', 'a'])
    expect(totalPages).toBe(1)
  })
})
