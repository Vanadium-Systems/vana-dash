import { afterEach, describe, expect, it, vi } from 'vitest'
import { genericConnector } from './index.js'
import type { PlatformConfig } from '../types.js'

const config: PlatformConfig = {
  id: 'p1',
  name: 'Test',
  type: 'generic',
  apiUrl: 'https://example.com',
  apiKey: 'secret-key',
  metricMappings: [
    { metricKey: 'revenue', unit: 'RON', path: '/stats.json#.totals.revenue', kind: 'number' },
    { metricKey: 'stock_kg', path: '/weight', kind: 'number' },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const res = handler(String(url))
      return new Response(typeof res.body === 'string' ? res.body : JSON.stringify(res.body), { status: res.status ?? 200 })
    }),
  )
}

describe('generic connector — fetchMetrics', () => {
  it('face GET pe fiecare rută și extrage valoarea pe calea JSON punctată', async () => {
    const calls: string[] = []
    mockFetch((url) => {
      calls.push(url)
      if (url.endsWith('/stats.json')) return { body: { totals: { revenue: 4200.5 } } }
      return { body: 1234 }
    })

    const metrics = await genericConnector.fetchMetrics(config, new Date(), new Date())
    expect(calls).toEqual(['https://example.com/stats.json', 'https://example.com/weight'])
    expect(metrics).toHaveLength(2)
    expect(metrics[0]).toMatchObject({ metricKey: 'revenue', value: 4200.5, unit: 'RON' })
    expect(metrics[1]).toMatchObject({ metricKey: 'stock_kg', value: 1234 })
  })

  it('trimite Authorization Bearer cu cheia decriptată', async () => {
    let auth = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        auth = String(new Headers(init?.headers).get('Authorization'))
        return new Response('7', { status: 200 })
      }),
    )
    await genericConnector.fetchMetrics({ ...config, metricMappings: [{ metricKey: 'stock_kg', path: '/weight', kind: 'number' }] }, new Date(), new Date())
    expect(auth).toBe('Bearer secret-key')
  })

  it('răspuns non-OK aruncă eroare (sync_log o prinde ca FAILED)', async () => {
    mockFetch(() => ({ status: 500, body: 'boom' }))
    await expect(genericConnector.fetchMetrics(config, new Date(), new Date())).rejects.toThrow(/500/)
  })

  it('cale fără număr produce eroare clară, nu NaN silențios', async () => {
    mockFetch(() => ({ body: { nope: 'text' } }))
    await expect(
      genericConnector.fetchMetrics({ ...config, metricMappings: [{ metricKey: 'revenue', path: '/stats.json#.nope', kind: 'number' }] }, new Date(), new Date()),
    ).rejects.toThrow(/nu conține un număr/)
  })

  it('mapările invalide (path fără /) sunt ignorate, nu blochează sync-ul', async () => {
    mockFetch(() => ({ body: 5 }))
    const metrics = await genericConnector.fetchMetrics(
      { ...config, metricMappings: [{ metricKey: 'ok', path: '/x', kind: 'number' }, { metricKey: 'bad', path: 'no-slash', kind: 'number' }] },
      new Date(),
      new Date(),
    )
    expect(metrics).toHaveLength(1)
  })
})

describe('generic connector — checkHealth', () => {
  it('folosește healthPath când există, altfel rădăcina apiUrl', async () => {
    const calls: string[] = []
    mockFetch((url) => {
      calls.push(url)
      return { body: { ok: true } }
    })

    await genericConnector.checkHealth({ ...config, healthPath: '/healthz' })
    await genericConnector.checkHealth(config)
    expect(calls).toEqual(['https://example.com/healthz', 'https://example.com/'])
  })

  it('HTTP non-OK = degraded cu mesaj, excepție de rețea = down', async () => {
    mockFetch(() => ({ status: 503, body: '' }))
    const degraded = await genericConnector.checkHealth({ ...config, healthPath: null })
    expect(degraded.status).toBe('degraded')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const down = await genericConnector.checkHealth({ ...config, healthPath: null })
    expect(down.status).toBe('down')
  })
})
