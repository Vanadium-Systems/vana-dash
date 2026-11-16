import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply } from 'fastify'

export interface CookieSerializeOptions {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: 'lax' | 'strict' | 'none' | boolean
  secure?: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    cookies: Record<string, string | undefined>
  }
  interface FastifyReply {
    setCookie(name: string, value: string, options?: CookieSerializeOptions): FastifyReply
    clearCookie(name: string, options?: CookieSerializeOptions): FastifyReply
  }
}

export function parseCookies(header: string | undefined): Record<string, string | undefined> {
  const cookies: Record<string, string | undefined> = {}
  if (!header) return cookies

  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx <= 0) continue
    const name = part.slice(0, eqIdx).trim()
    if (!name) continue
    let val = part.slice(eqIdx + 1).trim()
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1)
    }
    try {
      cookies[name] = decodeURIComponent(val)
    } catch {
      cookies[name] = val
    }
  }
  return cookies
}

export function serializeCookie(name: string, value: string, options: CookieSerializeOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  }
  if (options.domain) {
    parts.push(`Domain=${options.domain}`)
  }
  if (options.path) {
    parts.push(`Path=${options.path}`)
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`)
  }
  if (options.httpOnly) {
    parts.push('HttpOnly')
  }
  if (options.secure) {
    parts.push('Secure')
  }
  if (options.sameSite) {
    const s = options.sameSite === true ? 'Strict' : options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)
    parts.push(`SameSite=${s}`)
  }

  return parts.join('; ')
}

function appendSetCookie(reply: FastifyReply, serialized: string): void {
  const existing = reply.getHeader('set-cookie')
  if (!existing) {
    reply.header('Set-Cookie', serialized)
  } else if (Array.isArray(existing)) {
    reply.header('Set-Cookie', [...existing.map(String), serialized])
  } else {
    reply.header('Set-Cookie', [String(existing), serialized])
  }
}

export const cookiePlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('cookies', null as unknown as Record<string, string | undefined>)

  app.addHook('onRequest', async (request) => {
    request.cookies = parseCookies(request.headers.cookie)
  })

  app.decorateReply('setCookie', function (this: FastifyReply, name: string, value: string, options?: CookieSerializeOptions) {
    appendSetCookie(this, serializeCookie(name, value, options))
    return this
  })

  app.decorateReply('clearCookie', function (this: FastifyReply, name: string, options?: CookieSerializeOptions) {
    appendSetCookie(
      this,
      serializeCookie(name, '', {
        ...options,
        maxAge: 0,
        expires: new Date(0),
      }),
    )
    return this
  })
})
