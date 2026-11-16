import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'

export interface SecurityHeadersOptions {
  origin: string
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'origin-agent-cluster': '?1',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-dns-prefetch-control': 'off',
  'x-download-options': 'noopen',
  'x-frame-options': 'SAMEORIGIN',
  'x-permitted-cross-domain-policies': 'none',
  'x-xss-protection': '0',
}

const ALLOWED_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE'

export const securityHeadersPlugin = fp<SecurityHeadersOptions>(async (app: FastifyInstance, opts) => {
  const allowedOrigin = opts.origin

  app.addHook('onRequest', async (request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value)
    }

    reply.header('access-control-allow-origin', allowedOrigin)
    reply.header('access-control-allow-credentials', 'true')

    if (request.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', ALLOWED_METHODS)
      reply.header('vary', 'Access-Control-Request-Headers')
      const reqHeaders = request.headers['access-control-request-headers']
      if (typeof reqHeaders === 'string' && reqHeaders.length > 0) {
        reply.header('access-control-allow-headers', reqHeaders)
      }
      return reply.code(204).send()
    }
  })
})
