import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { securityHeadersPlugin } from './security-headers.js'

const ORIGIN = 'http://localhost:5174'

describe('securityHeadersPlugin', () => {
  it('sets all expected security and CORS headers on GET', async () => {
    const app = Fastify()
    await app.register(securityHeadersPlugin, { origin: ORIGIN })
    app.get('/health', async () => ({ status: 'ok' }))

    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: ORIGIN } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(res.headers['origin-agent-cluster']).toBe('?1')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000; includeSubDomains')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-dns-prefetch-control']).toBe('off')
    expect(res.headers['x-download-options']).toBe('noopen')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none')
    expect(res.headers['x-xss-protection']).toBe('0')
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    await app.close()
  })

  it('handles OPTIONS preflight for the configured origin', async () => {
    const app = Fastify()
    await app.register(securityHeadersPlugin, { origin: ORIGIN })
    app.post('/items', async () => ({ ok: true }))

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/items',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['access-control-allow-methods']).toBe('GET,HEAD,PUT,PATCH,POST,DELETE')
    expect(res.headers['access-control-allow-headers']).toBe('content-type')
    expect(res.headers['vary']).toBe('Access-Control-Request-Headers')
    await app.close()
  })
})
